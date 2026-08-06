import { COMM_GATEWAY_URL, CONFIG } from "./config.js";
import { isValidPdfHref } from "./pdf.js";

function makeAbortError() {
  return new DOMException("資料庫掃描已取消", "AbortError");
}

export function parseTranscriptDate(value) {
  const text = String(value || "").trim();
  const match = text
    .replace(/[年月.-]/g, "/")
    .replace(/日/g, "")
    .match(/(?:^|\D)(\d{2,4})\/(\d{1,2})\/(\d{1,2})(?:\D|$)/);
  if (!match) return null;

  let year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (match[1].length < 4) year += 1911;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return time;
}

export function parseOwnerLinkParams(link) {
  const onclick = link?.getAttribute?.("onclick") || "";
  const match = onclick.match(/checkAndShowCommunityOwnerAddr\((.*)\)/);
  if (!match) return null;
  try {
    const values = JSON.parse(`[${match[1].replace(/'/g, '"')}]`);
    const etrIdx = String(values[1] || "");
    const ownerIdx = String(values[2] || "");
    if (!etrIdx || !ownerIdx) return null;
    return {
      pdf: values[0] || "",
      etrIdx,
      ownerIdx,
      checkViewLog: values[3] === true,
      city: values[4] || "",
      district: values[5] || "",
      sessionId: values[6] || "",
      etrNo: values[7] || "",
      label: (link.textContent || "").replace(/\s+/g, " ").trim(),
      displayedDateValue: parseTranscriptDate(link.textContent)
    };
  } catch {
    return null;
  }
}

export function selectLatestOwnerParams(paramsList) {
  const valid = paramsList.filter((item) => item?.etrIdx && item?.ownerIdx);
  if (!valid.length) return null;
  const dated = valid.filter((item) => Number.isFinite(item.displayedDateValue));
  if (!dated.length) return { params: valid[0], usedDateFallback: true };
  const params = dated.reduce((latest, item) => item.displayedDateValue > latest.displayedDateValue ? item : latest);
  return { params, usedDateFallback: false };
}

export function waitWithSignal(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(makeAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function requestOwnerDetails(params, {
  signal,
  timeoutMs = CONFIG.OWNER_API_TIMEOUT_MS
} = {}) {
  if (signal?.aborted) throw makeAbortError();
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(COMM_GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: controller.signal,
      body: JSON.stringify({
        Method: "GetOwnerDetail",
        Data: { Etr_idx: params.etrIdx, Owner_idx: params.ownerIdx }
      })
    });
    if (!response.ok) throw new Error(`CommGateway HTTP ${response.status}`);

    const result = await response.json();
    if (String(result?.Status) !== "1") throw new Error(result?.Message || `CommGateway status ${result?.Status ?? "unknown"}`);
    const details = Array.isArray(result.Data) ? result.Data.filter((item) => item && typeof item === "object") : [];
    if (!details.length) throw new Error("API 回傳空資料");
    return { result, details };
  } catch (error) {
    if (signal?.aborted) throw makeAbortError();
    if (timedOut) throw new Error(`GetOwnerDetail timeout（${timeoutMs}ms）`);
    throw error;
  } finally {
    clearTimeout(timeoutTimer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function requestOwnerDetailsWithRetry(params, {
  signal,
  timeoutMs = CONFIG.OWNER_API_TIMEOUT_MS,
  retryDelays = CONFIG.OWNER_API_RETRY_DELAYS_MS,
  onRetry
} = {}) {
  const maxAttempts = retryDelays.length + 1;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await requestOwnerDetails(params, { signal, timeoutMs });
      return { ...response, attempts: attempt, retries: attempt - 1 };
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      lastError = error;
      if (attempt >= maxAttempts) break;
      const delayMs = retryDelays[attempt - 1];
      onRetry?.({ attempt, nextAttempt: attempt + 1, delayMs, error });
      await waitWithSignal(delayMs, signal);
    }
  }

  lastError.attempts = maxAttempts;
  throw lastError;
}

function detailDate(detail) {
  return detail?.RegPrintDate
    ?? detail?.TranscriptDate
    ?? detail?.PrintDate
    ?? detail?.EtrDate
    ?? detail?.RegDate
    ?? "";
}

export function selectLatestDetail(details) {
  const valid = details.filter((item) => item && typeof item === "object" && [
    item.BuildAddr, item.Address, item.Owner, item.PDF, detailDate(item),
    item.BuiMPin, item.BuiAuxPin, item.BuiTotPin
  ].some((value) => value != null && String(value).trim() !== ""));
  if (!valid.length) return null;
  const dated = valid
    .map((detail, sourceIndex) => ({ detail, sourceIndex, dateValue: parseTranscriptDate(detailDate(detail)) }))
    .filter((item) => Number.isFinite(item.dateValue));

  if (!dated.length) {
    return { detail: valid[0], sourceIndex: 0, usedDateFallback: true, parsedDateValue: null };
  }
  const newest = dated.reduce((latest, item) => item.dateValue > latest.dateValue ? item : latest);
  return {
    detail: newest.detail,
    sourceIndex: newest.sourceIndex,
    usedDateFallback: false,
    parsedDateValue: newest.dateValue
  };
}

function postalCode(detail, address) {
  const explicit = detail?.ZipCode ?? detail?.ZIP ?? detail?.Zip ?? detail?.PostalCode ?? detail?.PostCode ?? detail?.BuildZipCode;
  if (explicit != null && String(explicit).trim()) return String(explicit).trim();
  return String(address || "").match(/^\s*(\d{3,6})\b/)?.[1] || "";
}

export function normalizeDatabaseRecord(unit, selectedDetail, { attempts = 1 } = {}) {
  const detail = selectedDetail.detail;
  const address = detail.BuildAddr || detail.Address || "";
  const pdfUrl = detail.PDF || "";
  const usedDateFallback = !!unit.usedDateFallback || !!selectedDetail.usedDateFallback;
  const hasValidPdf = isValidPdfHref(pdfUrl);
  const queryResult = !hasValidPdf
    ? (usedDateFallback ? "成功（日期 fallback、無有效 PDF）" : "成功（無有效 PDF）")
    : (usedDateFallback ? "成功（日期 fallback）" : "成功（最新日期）");

  return {
    路段: unit.routeLabel,
    門牌: unit.householdLabel,
    所有權人: detail.Owner || "",
    郵遞區號: postalCode(detail, address),
    完整地址: address,
    主建坪: detail.BuiMPin ?? "",
    附屬坪: detail.BuiAuxPin ?? "",
    總坪: detail.BuiTotPin ?? "",
    謄本日期: detailDate(detail),
    "PDF URL": pdfUrl,
    Etr_idx: unit.params.etrIdx,
    Owner_idx: unit.params.ownerIdx,
    查詢結果: queryResult,
    日期fallback: usedDateFallback,
    API嘗試次數: attempts
  };
}

export function databaseRecordKey(record) {
  return `${record.Etr_idx}|${record.Owner_idx}|${record["PDF URL"] || ""}`;
}
