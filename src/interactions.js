import { sleep } from "./config.js";
import { isVisible, waitFor, waitForPageIdle, waitForPageBusyAppear } from "./utils.js";
import { findDropdownForAnchor } from "./scanner.js";
import { CONFIG } from "./config.js";

export function visibleModal() {
  const cands = Array.from(document.querySelectorAll('.modal, [role="dialog"]')).filter(isVisible);
  if (!cands.length) return null;
  for (const m of cands) if ((m.textContent || "").includes("所有權人明細")) return m;
  return cands[0];
}

export function firstOwnerLinkOf(anchor) {
  const dd = findDropdownForAnchor(anchor);
  if (!dd) return null;
  return dd.querySelector("li a, a");
}

export async function clickOpen(anchor) {
  let dd = findDropdownForAnchor(anchor);
  try { anchor.scrollIntoView({ block: "center", inline: "center" }); } catch {}
  anchor.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  anchor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await sleep(150);
  if (!dd) dd = findDropdownForAnchor(anchor);
  if (dd && isVisible(dd)) return true;
  try { anchor.click(); } catch {}
  await sleep(150);
  if (!dd) dd = findDropdownForAnchor(anchor);
  return dd ? isVisible(dd) : true;
}

export async function clickClose(anchor) {
  const dd = findDropdownForAnchor(anchor);
  if (!dd || !isVisible(dd)) return true;
  anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await sleep(120);
  if (!isVisible(dd)) return true;
  try { anchor.click(); } catch {}
  await sleep(120);
  return !isVisible(dd);
}

export function invokeJsHrefIfNeeded(linkEl) {
  if (!linkEl) return false;
  const hrefRaw = (linkEl.getAttribute("href") || "").trim();
  if (/^javascript:/i.test(hrefRaw)) {
    const js = hrefRaw.replace(/^javascript:/i, "").trim();
    const m = js.match(/__doPostBack\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/);
    if (m && typeof window.__doPostBack === "function") {
      window.__doPostBack(m[1], m[2]);
      return true;
    }
    if (typeof linkEl.onclick === "function") {
      linkEl.onclick.call(linkEl);
      return true;
    }
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    linkEl.addEventListener("click", (e) => e.preventDefault(), { once: true, capture: true });
    linkEl.dispatchEvent(ev);
    return true;
  }
  try { linkEl.click(); return true; } catch {}
  linkEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  return true;
}

export async function clickFirstOwnerAndWaitModal(anchor) {
  await clickOpen(anchor);
  const link = firstOwnerLinkOf(anchor);
  if (!link) return { opened: false, modal: null };

  invokeJsHrefIfNeeded(link);

  await waitForPageBusyAppear(2000);
  await waitForPageIdle(CONFIG.PER_ITEM_TIMEOUT_MS);

  const modal = await waitFor(() => {
    const m = visibleModal();
    if (m) return m;
    return document.querySelector("a#aPdf[href]") ? true : null;
  }, { timeout: 5000, interval: 80 });

  return { opened: !!modal, modal: modal === true ? null : modal };
}

export function modalCloseButton(modal) {
  if (!modal) return null;
  for (const b of modal.querySelectorAll("button, a")) {
    const t = (b.innerText || b.textContent || "").trim();
    if (t === "關閉" || t === "关闭" || t.toLowerCase() === "close") return b;
  }
  return modal.querySelector('.close, [data-dismiss="modal"], [aria-label="Close"]');
}

export async function closeModal(modal) {
  if (!modal) return false;
  const btn = modalCloseButton(modal);
  if (btn) {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const ok = await waitFor(() => !isVisible(modal), { timeout: 2500, interval: 80 });
    if (ok !== null) return true;
  }
  modal.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, which: 27, bubbles: true }));
  await sleep(150);
  return !isVisible(modal);
}

export async function closeCurrentModalIfAny() {
  const modal = visibleModal();
  if (modal) await closeModal(modal);
}

export async function closeAfterExtraction(anchor, modal) {
  if (modal) await closeModal(modal);
  await sleep(120);
  await clickClose(anchor);
}
