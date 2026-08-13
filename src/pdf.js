// API calls — DO NOT MODIFY endpoint or request/response structure
import { COMM_GATEWAY_URL } from "./config.js";
import { sleep } from "./config.js";
import { isVisible } from "./utils.js";
import { firstOwnerLinkOf } from "./interactions.js";

export function isValidPdfHref(href) {
  return typeof href === "string" && /\/ycut\/pdf\/.+\/\.pdf\/?$/i.test(href);
}

export async function waitForValidPdfHref(modal, timeoutMs, previousHref = "") {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const local = modal?.querySelector?.("a#aPdf[href]");
    if (local && isValidPdfHref(local.href) && local.href !== previousHref) return local.href;
    const global = document.querySelector("a#aPdf[href]");
    if (global && isVisible(global) && isValidPdfHref(global.href) && global.href !== previousHref) return global.href;
    await sleep(120);
  }
  return null;
}

export function extractPdfHrefFromModal(modal) {
  if (modal) {
    const a1 = modal.querySelector("a#aPdf[href]");
    if (a1 && isValidPdfHref(a1.href)) return a1.href;
    for (const a of modal.querySelectorAll("a[href]")) {
      const i = a.querySelector("i");
      if (i && /pdf/i.test(String(i.className)) && isValidPdfHref(a.href)) return a.href;
      const href = a.getAttribute("href") || "";
      if (isValidPdfHref(href)) return new URL(href, location.origin).href;
    }
  }
  const g = document.querySelector("a#aPdf[href]");
  if (g && isValidPdfHref(g.href)) return g.href;
  return null;
}

export function parseOwnerParams(anchor) {
  const link = firstOwnerLinkOf(anchor);
  const onclick = link?.getAttribute("onclick") || "";
  const match = onclick.match(/checkAndShowCommunityOwnerAddr\((.*)\)/);
  if (!match) return null;

  const jsonish = `[${match[1].replace(/'/g, '"')}]`;
  try {
    const values = JSON.parse(jsonish);
    return {
      pdf: values[0] || "",
      etrIdx: String(values[1] || ""),
      ownerIdx: String(values[2] || ""),
      checkViewLog: values[3] === true,
      city: values[4] || "",
      district: values[5] || "",
      sessionId: values[6] || "",
      etrNo: values[7] || "",
      label: (link.textContent || "").trim()
    };
  } catch {
    return null;
  }
}

export async function fetchOwnerDetail(params) {
  const res = await fetch(COMM_GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      Method: "GetOwnerDetail",
      Data: { Etr_idx: params.etrIdx, Owner_idx: params.ownerIdx }
    })
  });

  if (!res.ok) throw new Error(`CommGateway HTTP ${res.status}`);

  const result = await res.json();
  if (result.Status !== "1") throw new Error(result.Message || `CommGateway status ${result.Status}`);

  const detail = result.Data && result.Data[0];
  if (!detail) throw new Error("API 回傳空資料");
  return detail;
}

export async function getPdfByApi(anchor) {
  const params = parseOwnerParams(anchor);
  if (!params) throw new Error("找不到小藍人參數");

  if (params.pdf && isValidPdfHref(params.pdf)) return { url: params.pdf, detail: null, params };

  const detail = await fetchOwnerDetail(params);
  const pdf = detail.PDF || "";
  if (!isValidPdfHref(pdf)) throw new Error("API 回傳沒有 PDF");
  return { url: pdf, detail, params };
}
