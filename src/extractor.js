import { CONFIG, sleep, log } from "./config.js";
import { STATE } from "./state.js";
import { waitForPageIdle } from "./utils.js";
import { getAreaFromAnchor, getAreaFilterFromPanel } from "./scanner.js";
import { visibleModal, clickFirstOwnerAndWaitModal, closeCurrentModalIfAny, closeAfterExtraction } from "./interactions.js";
import { isValidPdfHref, waitForValidPdfHref, extractPdfHrefFromModal, getPdfByApi } from "./pdf.js";
import { setPanelStatus, setPanelWorking, updatePanelProgress } from "./panel.js";

function downloadJson(data, filename = `ycut_pdf_${Date.now()}.json`) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

function followAnchor(anchor) {
  if (!STATE.autoFollow || document.hidden) return;
  const cell = anchor?.closest?.("td");
  if (!cell) return;
  cell.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "nearest"
  });
}

function buildCandidates() {
  const { min, max } = getAreaFilterFromPanel();
  return Array.from(STATE.nodes).filter((a) => {
    const area = getAreaFromAnchor(a);
    if (area == null) return false;
    if (min != null && area < min) return false;
    if (max != null && area > max) return false;
    if (STATE.doorplateSelectEnabled && STATE.selectedColIdx.size > 0) {
      const td = a.closest("td");
      const col = td ? td.cellIndex : null;
      if (col == null || !STATE.selectedColIdx.has(col)) return false;
    }
    return true;
  });
}

export async function exportPdfLinksAsJson({
  delayBetween = CONFIG.DELAY_BETWEEN_MS,
  collapseAfter = true,
  perItemTimeout = CONFIG.PER_ITEM_TIMEOUT_MS,
  retries = CONFIG.MAX_RETRIES_PER_ITEM
} = {}) {
  if (STATE.acting) return;

  const candidates = buildCandidates();
  if (!candidates.length) {
    setPanelStatus("篩選後沒有符合建坪的戶別");
    alert("篩選後沒有任何符合建坪區間的戶別。");
    return;
  }

  STATE.acting = true;
  const total = candidates.length;
  setPanelWorking(true, `擷取 PDF 中…（篩選後 ${total} 戶）`);

  const urls = [];
  const failed = [];

  for (let idx = 0; idx < total; idx++) {
    const a = candidates[idx];
    updatePanelProgress(idx, total);
    followAnchor(a);
    await closeCurrentModalIfAny();
    await waitForPageIdle(perItemTimeout);

    let got = null;
    let lastError = "";

    try {
      got = (await getPdfByApi(a)).url;
    } catch (e) {
      lastError = e?.message || "API 擷取失敗";
    }

    for (let attempt = 0; attempt <= retries && !got; attempt++) {
      let modal = null;
      try {
        const previousHref = extractPdfHrefFromModal(visibleModal());
        const result = await clickFirstOwnerAndWaitModal(a);
        modal = result.modal || visibleModal();
        if (!result.opened) lastError = "未開啟明細";

        const hrefReady = await waitForValidPdfHref(modal || null, perItemTimeout, previousHref);
        const fallbackHref = extractPdfHrefFromModal(modal || null);
        got = hrefReady || (fallbackHref && fallbackHref !== previousHref ? fallbackHref : null);
        await waitForPageIdle(perItemTimeout);
        if (!got) { lastError = "找不到 PDF 連結"; await sleep(300); }
      } catch (e) {
        lastError = e?.message || "擷取例外";
        await sleep(300);
      } finally {
        if (collapseAfter) await closeAfterExtraction(a, modal);
      }
    }

    if (got && isValidPdfHref(got)) urls.push(got);
    else failed.push({ index: idx + 1, text: (a.textContent || "").trim(), reason: lastError || "未知原因" });

    updatePanelProgress(idx + 1, total);
    await sleep(delayBetween);
  }

  const uniq = Array.from(new Set(urls));
  downloadJson(uniq, `ycut_pdf_${Date.now()}.json`);
  if (failed.length) log("PDF 擷取失敗項目", failed);
  setPanelWorking(false, `已擷取 ${urls.length}/${total}，不重複 ${uniq.length}，失敗 ${failed.length}`);
}
