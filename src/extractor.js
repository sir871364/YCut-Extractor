import { CONFIG, sleep, log } from "./config.js";
import { STATE, anyExtractorRunning, legacyExtractorState } from "./state.js";
import { waitForPageIdle } from "./utils.js";
import { getAreaFromAnchor, getAreaFilterFromPanel, scan } from "./scanner.js";
import { getDoorplateForCell } from "./doorplate.js";
import { visibleModal, clickFirstOwnerAndWaitModal, closeCurrentModalIfAny, closeAfterExtraction } from "./interactions.js";
import { isValidPdfHref, waitForValidPdfHref, extractPdfHrefFromModal, getPdfByApi, parseOwnerParams } from "./pdf.js";
import { scanAllRoutePages, throwIfAborted } from "./route-scanner.js";
import { waitWithSignal } from "./owner-api.js";
import { startCoreAccessWatchdog } from "./license.js";
import { exportPdfResults, getCommunityName, normalizePdfUrls } from "./export.js";
import {
  clearExtractionStates,
  markAnchorExtractionState,
  resetPanelProgress,
  setCancelEnabled,
  setPanelStatus,
  setPanelWorking,
  updatePanelProgress,
  updateRouteProgress
} from "./panel.js";

// 擷取路徑目前為「純模擬人工點擊」：點擊失敗就算失敗，不回頭走 API。
// 想恢復 API 後援把這個改成 true 即可（建立PDF資料庫不受此旗標影響，仍為純 API）。
const EXTRACT_API_FALLBACK = false;

/** 回傳 [min, max] 區間內的隨機毫秒數 */
function randomDelayMs(minMs, maxMs) {
  const low = Math.max(0, Math.min(minMs, maxMs));
  const high = Math.max(minMs, maxMs);
  return Math.round(low + Math.random() * (high - low));
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
    // 用門牌名稱比對，不能用欄位索引：跨路段／棟別時同一個索引會指向不同門牌
    if (STATE.doorplateSelectEnabled && STATE.selectedDoorplates.size > 0) {
      const doorplate = getDoorplateForCell(a.closest("td"));
      if (!doorplate || !STATE.selectedDoorplates.has(doorplate)) return false;
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
  delayMinMs = CONFIG.DELAY_BETWEEN_MIN_MS,
  delayMaxMs = CONFIG.DELAY_BETWEEN_MAX_MS,
  collapseAfter = true,
  perItemTimeout = CONFIG.PER_ITEM_TIMEOUT_MS,
  retries = CONFIG.MAX_RETRIES_PER_ITEM,
  routeValue = "",
  seenHouseholds = new Set(),
  onItemComplete = null,
  signal = null
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
    throwIfAborted(signal);
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

    // 主路徑：先模擬人工點擊（開小人選單 → 明細視窗 → 抓 PDF 連結）
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

    // 後援：模擬點擊全數失敗才改走 API（目前預設關閉）
    if (!got && EXTRACT_API_FALLBACK) {
      try {
        updatePanelProgress(idx, total, {
          title: "擷取 PDF 中",
          current,
          stage: "模擬點擊失敗，改用 API 後援"
        });
        got = (await getPdfByApi(a)).url;
      } catch (e) {
        lastError = e?.message || "API 擷取失敗";
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
    // 每戶之間改為隨機間隔；這也是取消最容易生效的點，用可中斷的版本
    if (idx + 1 < total) {
      const waitMs = randomDelayMs(delayMinMs, delayMaxMs);
      updatePanelProgress(idx + 1, total, {
        title: "擷取 PDF 中",
        current,
        stage: `等待 ${(waitMs / 1000).toFixed(1)} 秒後處理下一戶`
      });
      await waitWithSignal(waitMs, signal);
    }
  }

  return {
    urls,
    failed,
    candidateCount: filteredCandidates.length,
    scannedCount: candidates.length,
    duplicateHouseholds
  };
}

export function cancelLegacyScan() {
  if (!legacyExtractorState.running) return;
  legacyExtractorState.cancelRequested = true;
  legacyExtractorState.abortController?.abort();
  setPanelStatus("取消中，等待目前這一戶收尾…");
}

export async function scanAllRoutes(options = {}) {
  if (anyExtractorRunning()) return;

  const controller = new AbortController();
  const signal = controller.signal;
  const exportButton = document.getElementById("ycut-export-json");
  const databaseButton = document.getElementById("ycut-build-database");
  const originalButtonDisabled = exportButton?.disabled || false;
  const originalDatabaseButtonDisabled = databaseButton?.disabled || false;
  const allUrls = [];
  const allItemFailures = [];
  const routeFailures = [];
  const seenHouseholds = new Set();
  let successfulRoutes = 0;
  let emptyRouteCount = 0;
  let blockedByLicense = null;
  let routeCount = 0;
  let totalCandidates = 0;
  let completionText = "掃描未完成";

  legacyExtractorState.running = true;
  legacyExtractorState.cancelRequested = false;
  legacyExtractorState.abortController = controller;
  STATE.acting = true;
  if (exportButton) {
    exportButton.disabled = true;
    exportButton.setAttribute("aria-busy", "true");
  }
  if (databaseButton) databaseButton.disabled = true;
  setCancelEnabled(true);
  setPanelWorking(true, "準備掃描所有路段分頁");
  updateRouteProgress();

  // 開始前檢查一次不夠：這一輪可能跑數十分鐘，中途被停用必須當場中止
  const stopWatchdog = startCoreAccessWatchdog({
    signal,
    onBlocked: (status) => {
      blockedByLicense = status;
      setPanelStatus(status.message || "授權狀態已變更，擷取中止");
      controller.abort();
    }
  });

  try {
    const routeResult = await scanAllRoutePages({
      signal,
      includeGroups: options.includeGroups !== false,
      routeTimeout: options.routeTimeout,
      onGroupStart: ({ group, groupNumber, totalGroups }) => {
        if (group.label) setPanelStatus(`正在切換棟別：${group.label}（${groupNumber} / ${totalGroups}）`);
      },
      onGroupError: ({ failure }) => {
        routeFailures.push(failure);
        log("棟別切換失敗，繼續下一個棟別", failure);
      },
      onRouteStart: ({ route, routeNumber, totalRoutes, groupNumber, totalGroups }) => {
        routeCount = totalRoutes;
        updateRouteProgress({
          routeName: route.displayLabel,
          index: routeNumber,
          total: totalRoutes,
          found: allUrls.length,
          failed: routeFailures.length,
          groupNumber,
          totalGroups
        });
        setPanelStatus(`正在掃描路段：${route.displayLabel}`);
      },
      onRoute: async ({ route, routeNumber, totalRoutes, groupNumber, totalGroups, isEmptyRoute }) => {
        // 空白路段本來就沒東西可擷取，但一閃而過會讓人以為被跳過，所以明講
        if (isEmptyRoute) {
          emptyRouteCount++;
          updateRouteProgress({
            routeName: `${route.displayLabel}（無資料，略過）`,
            index: routeNumber,
            total: totalRoutes,
            found: allUrls.length,
            failed: routeFailures.length,
            groupNumber,
            totalGroups
          });
          setPanelStatus(`路段無資料，略過：${route.displayLabel}`);
          updatePanelProgress(0, 0, {
            title: "擷取 PDF 中",
            stage: `路段無資料，略過：${route.displayLabel}`
          });
          await sleep(600);
          return { urls: [], failed: [], candidateCount: 0, scannedCount: 0, duplicateHouseholds: 0 };
        }
        scan();
        const result = await scanCurrentRoute({
          ...options,
          signal,
          routeValue: route.value,
          seenHouseholds,
          onItemComplete: ({ found }) => updateRouteProgress({
            routeName: route.displayLabel,
            index: routeNumber,
            total: totalRoutes,
            found: allUrls.length + found,
            failed: routeFailures.length,
            groupNumber,
            totalGroups
          })
        });
        totalCandidates += result.candidateCount;
        allUrls.push(...result.urls);
        allItemFailures.push(...result.failed.map((item) => ({ ...item, route: route.displayLabel })));
        return result;
      },
      onRouteComplete: ({ route, routeNumber, totalRoutes, groupNumber, totalGroups }) => {
        successfulRoutes++;
        updateRouteProgress({
          routeName: route.displayLabel,
          index: routeNumber,
          total: totalRoutes,
          found: allUrls.length,
          failed: routeFailures.length,
          groupNumber,
          totalGroups
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
    if (totalCandidates === 0 && emptyRouteCount > 0 && emptyRouteCount >= routeCount) {
      completionText = `全部 ${routeCount} 個路段皆無資料`;
      alert(`全部 ${routeCount} 個路段都查無資料，沒有可擷取的戶別。`);
    } else if (totalCandidates === 0) {
      completionText = "篩選後沒有符合建坪的戶別";
      alert("篩選後沒有符合建坪的戶別，請調整條件後再試。");
    } else {
      const finalFailures = [
        ...routeFailures.map((failure) => ({
          stage: failure.stage || "route",
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
        `掃描棟別：${routeResult.groupCount}`,
        `掃描分頁：${routeCount}`,
        `成功分頁：${successfulRoutes}`,
        `空白分頁：${emptyRouteCount}`,
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
    if (blockedByLicense) {
      // 被授權服務中止時不匯出：緊急停止的語意是「停下來」，不是把手上的資料倒出來
      completionText = [
        blockedByLicense.message || "授權狀態已變更，擷取中止",
        `中止前已完成分頁：${successfulRoutes}`,
        `已擷取但未匯出：${allUrls.length}`
      ].join("\n");
      updatePanelProgress(0, 0, { title: "已中止", stage: "授權狀態已變更" });
    } else if (error?.name === "AbortError" || signal.aborted) {
      // 使用者主動取消時，已擷取到的 PDF 照樣匯出：每一戶都花了數秒，丟掉太浪費
      const uniqueUrls = normalizePdfUrls(allUrls);
      const partialFailures = allItemFailures.map((failure) => ({
        stage: "PDF extraction",
        route: failure.route,
        door: failure.text,
        attempts: options.retries == null ? CONFIG.MAX_RETRIES_PER_ITEM + 1 : options.retries + 1,
        reason: failure.reason
      }));
      if (uniqueUrls.length) exportPdfResults(uniqueUrls, partialFailures, getCommunityName());
      completionText = [
        "擷取已取消",
        `已完成分頁：${successfulRoutes}`,
        `找到 PDF：${allUrls.length}`,
        uniqueUrls.length ? `已匯出去重後 ${uniqueUrls.length} 筆` : "沒有可匯出的 PDF"
      ].join("\n");
      updatePanelProgress(0, 0, { title: "已取消", stage: "使用者取消擷取" });
    } else {
      completionText = `掃描中止：${error?.message || "未知錯誤"}`;
      log("全部路段掃描失敗", error);
    }
  } finally {
    stopWatchdog();
    controller.abort();
    legacyExtractorState.abortController = null;
    legacyExtractorState.cancelRequested = false;
    setCancelEnabled(false);
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
