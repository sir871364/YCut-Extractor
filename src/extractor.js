import { CONFIG, sleep, log } from "./config.js";
import { STATE, anyExtractorRunning, legacyExtractorState } from "./state.js";
import { waitForPageIdle } from "./utils.js";
import { getAreaFromAnchor, getAreaFilterFromPanel, scan } from "./scanner.js";
import { visibleModal, clickFirstOwnerAndWaitModal, closeCurrentModalIfAny, closeAfterExtraction } from "./interactions.js";
import { isValidPdfHref, waitForValidPdfHref, extractPdfHrefFromModal, getPdfByApi, parseOwnerParams } from "./pdf.js";
import { scanAllRoutePages } from "./route-scanner.js";
import { exportPdfResults, getCommunityName, normalizePdfUrls } from "./export.js";
import {
  clearExtractionStates,
  markAnchorExtractionState,
  resetPanelProgress,
  setPanelStatus,
  setPanelWorking,
  updatePanelProgress,
  updateRouteProgress
} from "./panel.js";

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

function getHouseholdKey(anchor, routeValue) {
  const params = parseOwnerParams(anchor);
  if (params?.etrIdx) return `etr:${params.etrIdx}`;
  if (params?.etrNo) return `etrno:${params.etrNo}`;
  const ownerCall = anchor?.closest?.("td")
    ?.querySelector?.("[onclick*='checkAndShowCommunityOwnerAddr']")
    ?.getAttribute?.("onclick");
  if (ownerCall) return `owner-call:${ownerCall}`;
  return `fallback:${routeValue}:${describeAnchor(anchor)}`;
}

export async function scanCurrentRoute({
  delayBetween = CONFIG.DELAY_BETWEEN_MS,
  collapseAfter = true,
  perItemTimeout = CONFIG.PER_ITEM_TIMEOUT_MS,
  retries = CONFIG.MAX_RETRIES_PER_ITEM,
  routeValue = "",
  seenHouseholds = new Set(),
  onItemComplete = null
} = {}) {
  const filteredCandidates = buildCandidates();
  const candidates = [];
  let duplicateHouseholds = 0;
  for (const anchor of filteredCandidates) {
    const householdKey = getHouseholdKey(anchor, routeValue);
    if (seenHouseholds.has(householdKey)) {
      duplicateHouseholds++;
      continue;
    }
    seenHouseholds.add(householdKey);
    candidates.push(anchor);
  }

  const total = candidates.length;
  clearExtractionStates();
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
    onItemComplete?.({ found: urls.length, failed: failed.length, done: idx + 1, total });
    await sleep(delayBetween);
  }

  return {
    urls,
    failed,
    candidateCount: filteredCandidates.length,
    scannedCount: candidates.length,
    duplicateHouseholds
  };
}

export async function scanAllRoutes(options = {}) {
  if (anyExtractorRunning()) return;

  const exportButton = document.getElementById("ycut-export-json");
  const databaseButton = document.getElementById("ycut-build-database");
  const originalButtonDisabled = exportButton?.disabled || false;
  const originalDatabaseButtonDisabled = databaseButton?.disabled || false;
  const allUrls = [];
  const allItemFailures = [];
  const routeFailures = [];
  const seenHouseholds = new Set();
  let successfulRoutes = 0;
  let routeCount = 0;
  let totalCandidates = 0;
  let completionText = "掃描未完成";

  legacyExtractorState.running = true;
  STATE.acting = true;
  if (exportButton) {
    exportButton.disabled = true;
    exportButton.setAttribute("aria-busy", "true");
  }
  if (databaseButton) databaseButton.disabled = true;
  setPanelWorking(true, "準備掃描所有路段分頁");
  updateRouteProgress();

  try {
    const routeResult = await scanAllRoutePages({
      routeTimeout: options.routeTimeout,
      onRouteStart: ({ route, routeNumber, totalRoutes }) => {
        routeCount = totalRoutes;
        updateRouteProgress({
          routeName: route.label,
          index: routeNumber,
          total: totalRoutes,
          found: allUrls.length,
          failed: routeFailures.length
        });
        setPanelStatus(`正在掃描路段：${route.label}`);
      },
      onRoute: async ({ route, routeNumber, totalRoutes }) => {
        scan();
        const result = await scanCurrentRoute({
          ...options,
          routeValue: route.value,
          seenHouseholds,
          onItemComplete: ({ found }) => updateRouteProgress({
            routeName: route.label,
            index: routeNumber,
            total: totalRoutes,
            found: allUrls.length + found,
            failed: routeFailures.length
          })
        });
        totalCandidates += result.candidateCount;
        allUrls.push(...result.urls);
        allItemFailures.push(...result.failed.map((item) => ({ ...item, route: route.label })));
        return result;
      },
      onRouteComplete: ({ route, routeNumber, totalRoutes }) => {
        successfulRoutes++;
        updateRouteProgress({
          routeName: route.label,
          index: routeNumber,
          total: totalRoutes,
          found: allUrls.length,
          failed: routeFailures.length
        });
      },
      onRouteError: ({ failure }) => {
        routeFailures.push(failure);
        log("路段掃描失敗，繼續下一頁", failure);
      },
      onBeforeRestore: () => closeCurrentModalIfAny(),
      onRestored: () => scan()
    });
    routeCount = routeResult.routeCount;

    const uniqueUrls = normalizePdfUrls(allUrls);
    if (totalCandidates === 0) {
      completionText = "篩選後沒有符合建坪的戶別";
      alert("篩選後沒有符合建坪的戶別，請調整條件後再試。");
    } else {
      const finalFailures = [
        ...routeFailures.map((failure) => ({
          stage: "route",
          route: failure.route,
          routeValue: failure.value,
          attempts: 0,
          reason: failure.reason
        })),
        ...allItemFailures.map((failure) => ({
          stage: "PDF extraction",
          route: failure.route,
          door: failure.text,
          attempts: options.retries == null ? CONFIG.MAX_RETRIES_PER_ITEM + 1 : options.retries + 1,
          reason: failure.reason
        }))
      ];
      exportPdfResults(uniqueUrls, finalFailures, getCommunityName());
      completionText = [
        `掃描分頁：${routeCount}`,
        `成功分頁：${successfulRoutes}`,
        `失敗分頁：${routeFailures.length}`,
        `找到 PDF：${allUrls.length}`,
        `去重後 PDF：${uniqueUrls.length}`
      ].join("\n");
    }

    if (allItemFailures.length) log("PDF 擷取失敗清單", allItemFailures);
    if (routeFailures.length) log("路段失敗清單", routeFailures);
    updatePanelProgress(routeCount, routeCount, {
      title: "擷取完成",
      current: routeFailures.length ? `失敗 ${routeFailures.length} 個分頁` : "全部分頁完成",
      stage: `PDF ${allUrls.length}，去重後 ${uniqueUrls.length}，戶別失敗 ${allItemFailures.length}`
    });
    updateRouteProgress({
      routeName: "全部完成",
      index: routeCount,
      total: routeCount,
      found: allUrls.length,
      failed: routeFailures.length
    });
  } catch (error) {
    completionText = `掃描中止：${error?.message || "未知錯誤"}`;
    log("全部路段掃描失敗", error);
  } finally {
    setPanelWorking(false, completionText);
    STATE.acting = false;
    legacyExtractorState.running = false;
    if (exportButton) {
      exportButton.disabled = originalButtonDisabled;
      exportButton.removeAttribute("aria-busy");
    }
    if (databaseButton) databaseButton.disabled = originalDatabaseButtonDisabled;
  }
}
