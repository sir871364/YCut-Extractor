// Authorization logic — DO NOT MODIFY
import { LICENSE_STATUS_API, PRODUCT_ID } from "./config.js";
import { setPanelStatus } from "./panel.js";

const LICENSE_CACHE_TTL_MS = 30 * 60 * 1000;

async function hasFreshLicenseCache(installId) {
  const stored = await chrome.storage.local.get([
    "license_status",
    "qr_licensed_install_id",
    "last_verified_at"
  ]);

  if (stored.license_status !== "valid" || stored.qr_licensed_install_id !== installId) {
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
      await chrome.storage.local.set({
        license_status: "valid",
        qr_licensed_install_id: stored.install_id,
        last_verified_at: new Date().toISOString()
      });
      return true;
    }

    await chrome.storage.local.set({ license_status: "invalid" });
    return false;
  } catch {
    const stored = await chrome.storage.local.get(["install_id"]);
    return !!stored.install_id && await hasFreshLicenseCache(stored.install_id);
  }
}

export async function requireLicenseForPremiumAction() {
  const ok = await hasValidLicense();
  if (ok) return true;
  alert("此功能需要 QR 授權後才能使用。\n\n請打開擴充工具 popup，產生 QR Code 並請管理員核准。");
  setPanelStatus("尚未 QR 授權，PDF / JSON 下載已鎖定");
  return false;
}
