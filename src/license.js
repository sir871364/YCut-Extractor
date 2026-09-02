// Authorization logic — DO NOT MODIFY
import { LICENSE_STATUS_API, PRODUCT_ID } from "./config.js";
import { setPanelStatus } from "./panel.js";
import { classifyCoreLicenseStatus, readAccountPolicy, ACCOUNT_REQUIRED_MESSAGE } from "./core-access.js";

const LICENSE_CACHE_TTL_MS = 30 * 60 * 1000;
const CORE_AUTH_TIMEOUT_MS = 8000;
const CORE_WATCHDOG_INTERVAL_MS = 60000;
let lastLicenseCheck = null;

function taiwanDateString() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isExpiredLicenseDate(expiresOn) {
  return !/^\d{4}-\d{2}-\d{2}$/.test(String(expiresOn || "")) || taiwanDateString() > expiresOn;
}

async function hasFreshLicenseCache(installId) {
  const stored = await chrome.storage.local.get([
    "license_status",
    "qr_licensed_install_id",
    "last_verified_at",
    "license_expires_on"
  ]);

  if (stored.license_status !== "valid" || stored.qr_licensed_install_id !== installId) {
    return false;
  }

  if (isExpiredLicenseDate(stored.license_expires_on)) {
    lastLicenseCheck = { reason: "expired", expires_on: stored.license_expires_on || null };
    await chrome.storage.local.set({ license_status: "invalid" });
    return false;
  }

  const verifiedAt = new Date(stored.last_verified_at || 0).getTime();
  return Number.isFinite(verifiedAt) && Date.now() - verifiedAt < LICENSE_CACHE_TTL_MS;
}

export async function hasValidLicense() {
  try {
    const stored = await chrome.storage.local.get(["install_id"]);
    if (!stored.install_id) return false;

    if (await hasFreshLicenseCache(stored.install_id)) {
      return true;
    }

    const statusUrl = `${LICENSE_STATUS_API}?product_id=${encodeURIComponent(PRODUCT_ID)}&install_id=${encodeURIComponent(stored.install_id)}`;
    const res = await fetch(statusUrl);
    const result = await res.json();

    if (result && result.success && result.active) {
      lastLicenseCheck = result;
      await chrome.storage.local.set({
        license_status: "valid",
        qr_licensed_install_id: stored.install_id,
        last_verified_at: new Date().toISOString(),
        license_expires_on: result.expires_on
      });
      return true;
    }

    lastLicenseCheck = result;
    await chrome.storage.local.set({
      license_status: "invalid",
      license_expires_on: result?.expires_on || null
    });
    return false;
  } catch {
    const stored = await chrome.storage.local.get(["install_id"]);
    return !!stored.install_id && await hasFreshLicenseCache(stored.install_id);
  }
}

// content script 拿不到 chrome.identity，改請 background 代查；
// background 回不了話時退回 popup 產生 QR 時存下的 google_account。兩邊都沒有就當沒登入。
async function getBrowserAccount() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "YCUT_GET_ACCOUNT" });
    if (res && res.google_sub && res.google_email) return res;
  } catch {}
  try {
    const stored = await chrome.storage.local.get(["google_account"]);
    const acct = stored.google_account;
    if (acct && acct.google_sub && acct.google_email) return acct;
  } catch {}
  return null;
}

/**
 * 即時向授權服務查詢一次核心狀態。永遠不丟例外：
 * 任何錯誤、逾時或格式異常都收斂成 unavailable，由呼叫端決定如何處置。
 */
export async function fetchCoreAccessDecision() {
  const stored = await chrome.storage.local.get(["install_id"]);
  if (!stored.install_id) {
    return { decision: "unavailable", message: "目前無法確認授權狀態，請稍後再試。", result: null };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CORE_AUTH_TIMEOUT_MS);
  try {
    const statusUrl = `${LICENSE_STATUS_API}?product_id=${encodeURIComponent(PRODUCT_ID)}&install_id=${encodeURIComponent(stored.install_id)}`;
    const response = await fetch(statusUrl, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("License status request failed");
    const result = await response.json();
    const status = classifyCoreLicenseStatus(result);
    if (status.decision === "unavailable") throw new Error("Invalid license status response");
    // 緊急停止優先於帳號政策：停用中要看到「已停用」，不是「請登入」
    if (status.decision === "suspended") return { ...status, result };

    // 伺服器下達的帳號綁定政策；欄位不存在＝optional＝行為與現在相同
    const policy = readAccountPolicy(result);
    if (policy.license === "required" && !(await getBrowserAccount())) {
      return { decision: "account_required", message: ACCOUNT_REQUIRED_MESSAGE, result };
    }
    return { ...status, result };
  } catch {
    return { decision: "unavailable", message: "目前無法確認授權狀態，請稍後再試。", result: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 掃描期間的持續監控：只在開始前檢查一次是不夠的，
 * 一輪擷取可能跑數十分鐘，管理員中途按下停止必須當場生效。
 * 依設定，只要不是 licensed（含查不到狀態）就立即中止。
 */
export function startCoreAccessWatchdog({ onBlocked, intervalMs = CORE_WATCHDOG_INTERVAL_MS, signal } = {}) {
  let finished = false;
  const stop = () => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    signal?.removeEventListener("abort", stop);
  };
  const timer = setInterval(async () => {
    if (finished || signal?.aborted) return;
    const status = await fetchCoreAccessDecision();
    if (finished || signal?.aborted) return;
    if (status.decision === "licensed") return;
    stop();
    onBlocked?.(status);
  }, intervalMs);
  signal?.addEventListener("abort", stop, { once: true });
  return stop;
}

export async function requireLicenseForPremiumAction() {
  const status = await fetchCoreAccessDecision();
  if (status.decision === "unavailable") {
    alert("目前無法確認授權狀態，請稍後再試。");
    setPanelStatus("無法即時確認授權狀態，PDF / JSON 下載已暫停");
    return false;
  }
  const result = status.result;
  if (status.decision === "suspended") {
    alert(status.message);
    setPanelStatus("系統管理員已暫停 PDF / JSON 擷取功能");
    return false;
  }

  if (status.decision === "account_required") {
    alert(status.message);
    setPanelStatus("請先登入瀏覽器帳號，PDF / JSON 下載已暫停");
    return false;
  }

  if (status.decision === "licensed") return true;
  if (result.reason === "expired") {
    const expiresOn = result.expires_on || "設定期限";
    alert(`授權已於 ${expiresOn} 到期。\n\n請打開擴充工具 popup，重新產生 QR Code 並請管理員核准。`);
    setPanelStatus(`授權已於 ${expiresOn} 到期，PDF / JSON 下載已鎖定`);
    return false;
  }
  alert("此功能需要 QR 授權後才能使用。\n\n請打開擴充工具 popup，產生 QR Code 並請管理員核准。");
  setPanelStatus("尚未 QR 授權，PDF / JSON 下載已鎖定");
  return false;
}
