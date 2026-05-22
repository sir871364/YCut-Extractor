import { CONFIG, sleep, log } from "./config.js";
import { STATE } from "./state.js";
import { waitForPageIdle } from "./utils.js";
import { getAreaFromAnchor, getAreaFilterFromPanel } from "./scanner.js";
import { visibleModal, clickFirstOwnerAndWaitModal, closeCurrentModalIfAny, closeAfterExtraction } from "./interactions.js";
import { isValidPdfHref, waitForValidPdfHref, extractPdfHrefFromModal, getPdfByApi } from "./pdf.js";
import {
  clearExtractionStates,
  markAnchorExtractionState,
  resetPanelProgress,
  setPanelStatus,
  setPanelWorking,
  updatePanelProgress
} from "./panel.js";

function downloadJson(data, filename = `ycut_pdf_${Date.now()}.json`) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
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

function describeAnchor(anchor) {
  const cell = anchor?.closest?.("td");
  const row = cell?.closest?.("tr");
  const table = cell?.closest?.("table");
  const area = getAreaFromAnchor(anchor);
  const floor = row?.querySelector?.("th")?.textContent?.trim()
    || row?.children?.[0]?.textContent?.trim()
    || "";
  let doorplate = "";

  if (cell && table) {
    const colIndex = cell.cellIndex;
    const rows = Array.from(table.querySelectorAll("tr"));
    for (const headerRow of rows) {
      const headerCell = headerRow.children?.[colIndex];
      const text = headerCell?.textContent?.replace(/\s+/g, " ").trim();
      if (text && text.includes("號")) {
        doorplate = text.replace(/^選\s*/, "");
        break;
      }
    }
  }

  const parts = [doorplate, floor].filter(Boolean);
  if (area != null) parts.push(`建坪 ${area}`);
  return parts.length
    ? parts.join(" / ")
    : (cell?.textContent || anchor?.textContent || "").replace(/\s+/g, " ").trim() || "未命名戶別";
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
    alert("篩選後沒有符合建坪的戶別，請調整條件後再試。");
    return;
  }

  STATE.acting = true;
  const total = candidates.length;
  clearExtractionStates();
  setPanelWorking(true, `擷取 PDF 中（篩選後 ${total} 戶）`);
  resetPanelProgress(total, {
    title: "擷取 PDF 中",
    stage: "準備開始"
  });

  const urls = [];
  const failed = [];

  for (let idx = 0; idx < total; idx++) {
    const a = candidates[idx];
    const current = describeAnchor(a);
    let got = null;
    let lastError = "";

    markAnchorExtractionState(a, "active");
    updatePanelProgress(idx, total, {
      title: "擷取 PDF 中",
      current,
      stage: "定位目前戶別"
    });
    followAnchor(a);

    await closeCurrentModalIfAny();
    updatePanelProgress(idx, total, {
      title: "擷取 PDF 中",
      current,
      stage: "等待頁面閒置"
    });
    await waitForPageIdle(perItemTimeout);

    try {
      updatePanelProgress(idx, total, {
        title: "擷取 PDF 中",
        current,
        stage: "嘗試 API 擷取"
      });
      got = (await getPdfByApi(a)).url;
    } catch (e) {
      lastError = e?.message || "API 擷取失敗";
    }

    for (let attempt = 0; attempt <= retries && !got; attempt++) {
      let modal = null;
      try {
        updatePanelProgress(idx, total, {
          title: "擷取 PDF 中",
          current,
          stage: `開啟小人選單（第 ${attempt + 1} 次）`
        });

        const previousHref = extractPdfHrefFromModal(visibleModal());
        const result = await clickFirstOwnerAndWaitModal(a);
        modal = result.modal || visibleModal();
        if (!result.opened) lastError = "無法開啟小人選單";

        updatePanelProgress(idx, total, {
          title: "擷取 PDF 中",
          current,
          stage: "等待 PDF 連結"
        });
        const hrefReady = await waitForValidPdfHref(modal || null, perItemTimeout, previousHref);
        const fallbackHref = extractPdfHrefFromModal(modal || null);
        got = hrefReady || (fallbackHref && fallbackHref !== previousHref ? fallbackHref : null);

        updatePanelProgress(idx, total, {
          title: "擷取 PDF 中",
          current,
          stage: "確認頁面狀態"
        });
        await waitForPageIdle(perItemTimeout);
        if (!got) {
          lastError = "找不到 PDF 連結";
          await sleep(300);
        }
      } catch (e) {
        lastError = e?.message || "擷取失敗";
        await sleep(300);
      } finally {
        if (collapseAfter) await closeAfterExtraction(a, modal);
      }
    }

    if (got && isValidPdfHref(got)) {
      urls.push(got);
      markAnchorExtractionState(a, "done");
    } else {
      markAnchorExtractionState(a, "failed");
      failed.push({ index: idx + 1, text: current, reason: lastError || "未知錯誤" });
    }

    updatePanelProgress(idx + 1, total, {
      title: "擷取 PDF 中",
      current,
      stage: got && isValidPdfHref(got) ? "此戶完成" : "此戶失敗"
    });
    await sleep(delayBetween);
  }

  const uniq = Array.from(new Set(urls));
  downloadJson(uniq, `ycut_pdf_${Date.now()}.json`);
  if (failed.length) log("PDF 擷取失敗清單", failed);

  setPanelWorking(false, `已擷取 ${urls.length}/${total}，不重複 ${uniq.length}，失敗 ${failed.length}`);
  updatePanelProgress(total, total, {
    title: "擷取完成",
    current: failed.length ? `失敗 ${failed.length} 戶，請查看 console` : "全部完成",
    stage: `成功 ${urls.length}，不重複 ${uniq.length}，失敗 ${failed.length}`
  });
}
