import { sleep } from "./config.js";

export function isVisible(el) {
  if (!el) return false;
  const st = getComputedStyle(el);
  return el.offsetParent !== null && st.visibility !== "hidden" && st.display !== "none";
}

export async function waitFor(fn, { timeout = 4000, interval = 80 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const v = fn();
      if (v) return v;
    } catch {}
    await sleep(interval);
  }
  return null;
}

export function pageIsBusy() {
  const selectors = [
    ".blockUI", ".ui-blockui", ".blockOverlay", ".blockMsg",
    ".loading", ".spinner", ".lds-spinner", ".modal:has(.loading)"
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const st = getComputedStyle(el);
      if (st.display !== "none" && st.visibility !== "hidden" && el.offsetParent !== null) return true;
    }
  }
  return (document.body.innerText || "").trim().includes("資料讀取中");
}

export async function waitForPageIdle(timeout = 30000, interval = 120) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (!pageIsBusy()) return true;
    await sleep(interval);
  }
  return false;
}

export async function waitForPageBusyAppear(timeout = 2000, interval = 80) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (pageIsBusy()) return true;
    await sleep(interval);
  }
  return false;
}
