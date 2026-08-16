import { CONFIG, log, sleep } from "./config.js";
import { STATE, anyExtractorRunning, databaseExtractorState } from "./state.js";
import { getAreaFilterFromPanel, getAreaFromCell, scan } from "./scanner.js";
import { getDoorplateForCell } from "./doorplate.js";
import {
  detectRouteEmptyState,
  getRouteSelect,
  scanAllRoutePages,
  switchRouteAndWait,
  throwIfAborted
} from "./route-scanner.js";
import {
  databaseRecordKey,
  normalizeDatabaseRecord,
  parseOwnerLinkParams,
  requestOwnerDetailsWithRetry,
  selectLatestDetail,
  selectLatestOwnerParams,
  waitWithSignal
} from "./owner-api.js";
import { isValidPdfHref } from "./pdf.js";
import {
  exportFailureList,
  exportPdfResults,
  getCommunityName
} from "./export.js";
import { setPanelWorking, setProgressMode, updateDatabaseProgress } from "./panel.js";

function floorForCell(cell) {
  const container = document.querySelector("#CommunityCase");
  let current = cell.closest("table");
  while (current && current !== container) {
    let previous = current.previousElementSibling;
    while (previous) {
      const text = (previous.textContent || "").replace(/\s+/g, " ").trim();
      const match = text.match(/(?:地下\s*)?[一二三四五六七八九十百千零〇0-9ＢB-]+\s*樓/);
      if (match) return match[0].replace(/\s+/g, "");
      previous = previous.previousElementSibling;
    }
    current = current.parentElement;
  }
  return "";
}

function collectCurrentRouteHouseholds(route, routeNumber) {
  const units = [];
  // 面板上的建坪與門牌勾選，兩種掃描都該遵守（原本只有「擷取PDF→JSON」有套用）
  const { min, max } = getAreaFilterFromPanel();
  const areaFilterActive = min != null || max != null;
  const doorplateFilterActive = STATE.doorplateSelectEnabled && STATE.selectedDoorplates.size > 0;
  let filteredOut = 0;

  const cells = document.querySelectorAll("#CommunityCase td");
  for (const cell of cells) {
    const links = Array.from(cell.querySelectorAll("ul.dropdown-menu li a[onclick*='checkAndShowCommunityOwnerAddr']"));
    if (!links.length) continue;
    const candidates = links.map(parseOwnerLinkParams).filter(Boolean);
    const selected = selectLatestOwnerParams(candidates);
    if (!selected) continue;

    const doorplate = getDoorplateForCell(cell);
    if (doorplateFilterActive && (!doorplate || !STATE.selectedDoorplates.has(doorplate))) {
      filteredOut++;
      continue;
    }
    if (areaFilterActive) {
      const area = getAreaFromCell(cell);
      // 建坪讀不到就無法確認是否落在範圍內，有設篩選時一律排除
      if (area == null || (min != null && area < min) || (max != null && area > max)) {
        filteredOut++;
        continue;
      }
    }

    const routeLabel = route.displayLabel || route.label;
    const floor = floorForCell(cell);
    const householdLabel = [doorplate, floor].filter(Boolean).join(" ")
      || (cell.textContent || "").replace(/\s+/g, " ").trim()
      || `${routeLabel} 戶別`;
    const householdKey = candidates
      .map((item) => `${item.etrIdx}:${item.ownerIdx}`)
      .sort()
      .join("|");

    units.push({
      routeLabel,
      routeValue: route.value,
      groupLabel: route.groupLabel || "",
      routeNumber,
      doorplate,
      floor,
      householdLabel,
      householdKey: householdKey || `${route.value}:${householdLabel}`,
      params: selected.params,
      usedDateFallback: selected.usedDateFallback
    });
  }
  return { units, filteredOut };
}

function getCurrentHouseholdRows() {
  return Array.from(document.querySelectorAll("#CommunityCase td")).filter((cell) => (
    cell.querySelector("ul.dropdown-menu li a[onclick*='checkAndShowCommunityOwnerAddr']")
  ));
}

function getHouseholdListFingerprint() {
  const container = document.querySelector("#CommunityCase");
  if (!container) return "";
  return Array.from(container.querySelectorAll(
    "ul.dropdown-menu li a[onclick*='checkAndShowCommunityOwnerAddr']"
  ))
    .map((link) => (link.getAttribute("onclick") || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort()
    .join("|");
}

async function waitForHouseholdListStable({
  previousFingerprint,
  requireChange,
  signal,
  timeout = 15000,
  interval = 200,
  stableChecks = 3
}) {
  const startedAt = Date.now();
  let lastFingerprint = "";
  let stableCount = 0;
  let emptySince = 0;
  let lastEmptyMarker = "";

  while (Date.now() - startedAt < timeout) {
    throwIfAborted(signal);
    const rows = getCurrentHouseholdRows();
    const fingerprint = getHouseholdListFingerprint();
    const changedFromPrevious = !!fingerprint && fingerprint !== previousFingerprint;
    const isCurrentList = rows.length > 0 && (!requireChange || changedFromPrevious);

    if (isCurrentList) {
      if (fingerprint === lastFingerprint) stableCount++;
      else {
        lastFingerprint = fingerprint;
        stableCount = 1;
      }
      if (stableCount >= stableChecks) {
        return { currentFingerprint: fingerprint, rowCount: rows.length, empty: false };
      }
    } else {
      stableCount = 0;
      lastFingerprint = fingerprint;
    }

    // 這個路段可能根本沒有小藍人（同社區、不同路段但查無資料）。
    // 這是合法結果，不是逾時，但仍要等狀態穩定才下結論，避免把載入中誤判成空的。
    if (rows.length === 0) {
      const emptyState = detectRouteEmptyState();
      const marker = emptyState.empty ? `${emptyState.explicit}` : "";
      if (!emptyState.empty) {
        emptySince = 0;
      } else {
        if (marker !== lastEmptyMarker || !emptySince) {
          lastEmptyMarker = marker;
          emptySince = Date.now();
        }
        const requiredMs = emptyState.explicit ? CONFIG.ROUTE_SETTLE_MS : CONFIG.ROUTE_EMPTY_GRACE_MS;
        if (Date.now() - emptySince >= requiredMs) {
          return { currentFingerprint: "", rowCount: 0, empty: true, explicit: emptyState.explicit };
        }
      }
    } else {
      emptySince = 0;
    }

    await sleep(interval);
  }

  throw new Error("等待新戶別清單載入逾時");
}

async function loadDatabaseRouteWithRetry(route, { signal, routeTimeout, maxAttempts = 3 } = {}) {
  const previousFingerprint = getHouseholdListFingerprint();
  const selectedBeforeSwitch = getRouteSelect()?.value ?? "";
  const requireChange = selectedBeforeSwitch !== route.value;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    throwIfAborted(signal);
    try {
      await switchRouteAndWait(
        route,
        Math.min(routeTimeout || CONFIG.ROUTE_REFRESH_TIMEOUT_MS, 10000),
        signal,
        { forceRefresh: attempt > 1 }
      );
      const actualRouteValue = getRouteSelect()?.value ?? "";
      if (actualRouteValue !== route.value) {
        throw new Error(`路段切換失敗：預期 ${route.value}，實際 ${actualRouteValue}`);
      }
      const stableResult = await waitForHouseholdListStable({
        previousFingerprint,
        requireChange,
        signal
      });
      // 確認是空白路段就直接收工，不要再重試兩次（那才是使用者看到的「卡住」）
      return { empty: !!stableResult.empty, explicit: !!stableResult.explicit };
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      lastError = error;
    }
  }

  if (lastError) lastError.routeAttempts = maxAttempts;
  throw lastError || new Error(`路段載入失敗：${route.label}`);
}

// 這個站的路段標籤：範圍一律用「~／～／至／到」，門牌自己的「-」等同「之」。
// 例：35-1~43-2 是「35之1號 到 43之2號」，不是「35 到 1」；93-1 是單一門牌，不是範圍。
// 舊版把 - 也當範圍分隔，35-1~43-2 會被解析成 {1,35}，導致 37/39/41 號被靜默丟棄。
function routeDoorplateRange(routeLabel) {
  const match = String(routeLabel || "")
    .match(/(\d+)(?:\s*[-－之]\s*\d+)?\s*[~～至到]\s*(\d+)(?:\s*[-－之]\s*\d+)?/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return { min: Math.min(first, second), max: Math.max(first, second) };
}

function doorplateNumber(doorplate) {
  const match = String(doorplate || "").match(/(\d+)(?:\s*[-－之]\s*\d+)?\s*號/);
  return match ? Number(match[1]) : null;
}

function snapshotButtonStates() {
  const ids = ["ycut-export-json", "ycut-build-database", "ycut-cancel-scan", "ycut-export-failures"];
  return new Map(ids.map((id) => {
    const button = document.getElementById(id);
    return [id, button ? button.disabled : null];
  }));
}

function setDatabaseButtonsRunning(running) {
  const legacyButton = document.getElementById("ycut-export-json");
  const databaseButton = document.getElementById("ycut-build-database");
  const cancelButton = document.getElementById("ycut-cancel-scan");
  const failureButton = document.getElementById("ycut-export-failures");
  if (legacyButton) legacyButton.disabled = running;
  if (databaseButton) databaseButton.disabled = running;
  if (cancelButton) cancelButton.disabled = !running;
  if (failureButton && running) failureButton.disabled = true;
}

function restoreButtons(states) {
  for (const [id, disabled] of states) {
    if (disabled == null) continue;
    const button = document.getElementById(id);
    if (button) button.disabled = disabled;
  }
  const failureButton = document.getElementById("ycut-export-failures");
  if (failureButton) failureButton.disabled = databaseExtractorState.lastFailures.length === 0;
}

function databaseProgress(metrics, extra = {}) {
  updateDatabaseProgress({
    routeNumber: metrics.routeNumber,
    totalRoutes: metrics.totalRoutes,
    groupNumber: metrics.groupNumber,
    totalGroups: metrics.totalGroups,
    scannedHouseholds: metrics.processedHouseholds,
    totalHouseholds: metrics.totalHouseholds,
    apiSuccess: metrics.apiSuccess,
    apiRetries: metrics.apiRetries,
    apiFailed: metrics.apiFailed,
    validPdf: metrics.validPdf,
    duplicateSkipped: metrics.duplicateSkipped,
    ...extra
  });
}

export function cancelDatabaseScan() {
  if (!databaseExtractorState.running) return;
  databaseExtractorState.cancelRequested = true;
  databaseExtractorState.abortController?.abort();
}

export function exportLastDatabaseFailures() {
  exportFailureList(databaseExtractorState.lastFailures, databaseExtractorState.lastCommunityName);
}

export async function buildPdfDatabase({ includeGroups = true } = {}) {
  if (anyExtractorRunning()) return;

  const buttonStates = snapshotButtonStates();
  const controller = new AbortController();
  const signal = controller.signal;
  const community = getCommunityName();
  const units = [];
  const unitKeys = new Set();
  const records = [];
  const recordKeys = new Set();
  const failures = [];
  const metrics = {
    routeNumber: 0,
    totalRoutes: 0,
    successfulRoutes: 0,
    emptyRoutes: 0,
    groupNumber: 0,
    totalGroups: 0,
    processedHouseholds: 0,
    totalHouseholds: 0,
    apiSuccess: 0,
    apiRetries: 0,
    apiFailed: 0,
    validPdf: 0,
    duplicateSkipped: 0,
    filteredSkipped: 0
  };
  let completionText = "資料庫掃描未完成";

  databaseExtractorState.running = true;
  databaseExtractorState.cancelRequested = false;
  databaseExtractorState.abortController = controller;
  databaseExtractorState.lastCommunityName = community;
  databaseExtractorState.lastFailures = [];
  STATE.acting = true;
  setDatabaseButtonsRunning(true);
  setProgressMode("database");
  setPanelWorking(true, "正在收集所有路段戶別");
  databaseProgress(metrics, { phase: "收集戶別" });

  try {
    const routeResult = await scanAllRoutePages({
      signal,
      includeGroups,
      loadRoute: async ({ route, routeTimeout, signal: routeSignal }) => (
        loadDatabaseRouteWithRetry(route, {
          signal: routeSignal,
          routeTimeout
        })
      ),
      onGroupStart: ({ group, groupNumber, totalGroups }) => {
        metrics.groupNumber = groupNumber;
        metrics.totalGroups = totalGroups;
        databaseProgress(metrics, { phase: group.label ? `切換棟別：${group.label}` : "切換棟別" });
      },
      onGroupError: ({ failure }) => {
        failures.push({
          stage: "group",
          route: failure.route,
          routeValue: failure.value,
          reason: failure.reason,
          attempts: 0,
          timestamp: new Date().toISOString()
        });
        databaseProgress(metrics, { phase: "棟別失敗" });
      },
      onRouteStart: ({ routeNumber, totalRoutes }) => {
        metrics.routeNumber = routeNumber;
        metrics.totalRoutes = totalRoutes;
        databaseProgress(metrics, { phase: "切換路段" });
      },
      onRoute: async ({ route, routeNumber, totalRoutes, isEmptyRoute }) => {
        throwIfAborted(signal);
        const selectedRouteValue = getRouteSelect()?.value ?? "";
        if (!route.currentOnly && selectedRouteValue !== route.value) {
          throw new Error(`路段切換失敗：預期 ${route.value}，實際 ${selectedRouteValue}`);
        }
        if (isEmptyRoute) {
          metrics.emptyRoutes++;
          metrics.routeNumber = routeNumber;
          metrics.totalRoutes = totalRoutes;
          databaseProgress(metrics, { phase: `路段無資料，略過：${route.displayLabel || route.label}` });
          return { householdCount: 0, empty: true };
        }
        scan();
        const collected = collectCurrentRouteHouseholds(route, routeNumber);
        const currentUnits = collected.units;
        metrics.filteredSkipped += collected.filteredOut;
        const range = routeDoorplateRange(route.label);
        for (const unit of currentUnits) {
          const parsedDoorplate = doorplateNumber(unit.doorplate);
          if (!unit.doorplate?.trim()) continue;
          if (range && parsedDoorplate != null && (parsedDoorplate < range.min || parsedDoorplate > range.max)) continue;
          if (unitKeys.has(unit.householdKey)) {
            metrics.duplicateSkipped++;
            continue;
          }
          unitKeys.add(unit.householdKey);
          units.push(unit);
        }
        metrics.totalHouseholds = units.length;
        metrics.routeNumber = routeNumber;
        metrics.totalRoutes = totalRoutes;
        databaseProgress(metrics, { phase: "收集戶別" });
        return { householdCount: currentUnits.length };
      },
      onRouteError: ({ error, failure }) => {
        const failureItem = {
          stage: "route",
          route: failure.route,
          routeValue: failure.value,
          reason: failure.reason,
          attempts: error?.routeAttempts || 0,
          timestamp: new Date().toISOString()
        };
        failures.push(failureItem);
        databaseProgress(metrics, { phase: "路段失敗" });
      },
      onRestored: () => scan()
    });

    metrics.totalRoutes = routeResult.routeCount;
    metrics.totalGroups = routeResult.groupCount;
    metrics.successfulRoutes = routeResult.successfulRoutes;
    metrics.totalHouseholds = units.length;

    for (let index = 0; index < units.length; index++) {
      throwIfAborted(signal);
      const unit = units[index];
      metrics.routeNumber = unit.routeNumber;
      databaseProgress(metrics, { phase: `查詢戶別：${unit.householdLabel}` });

      let apiAttempts = 0;
      try {
        const response = await requestOwnerDetailsWithRetry(unit.params, {
          signal,
          onRetry: () => {
            metrics.apiRetries++;
            databaseProgress(metrics, { phase: `API 重試：${unit.householdLabel}` });
          }
        });
        apiAttempts = response.attempts;
        const selectedDetail = selectLatestDetail(response.details);
        if (!selectedDetail) throw new Error("API 沒有可用的謄本資料");

        const record = normalizeDatabaseRecord(unit, selectedDetail, { attempts: response.attempts });
        metrics.apiSuccess++;
        const key = databaseRecordKey(record);
        if (recordKeys.has(key)) {
          metrics.duplicateSkipped++;
        } else {
          recordKeys.add(key);
          records.push(record);
          if (isValidPdfHref(record["PDF URL"])) {
            metrics.validPdf++;
          } else {
            failures.push({
              stage: "PDF validation",
              route: unit.routeLabel,
              routeValue: unit.routeValue,
              door: unit.householdLabel,
              etr_idx: unit.params.etrIdx,
              owner_idx: unit.params.ownerIdx,
              attempts: response.attempts,
              reason: "GetOwnerDetail 回傳沒有有效 PDF URL",
              timestamp: new Date().toISOString()
            });
          }
        }
      } catch (error) {
        if (error?.name === "AbortError" || signal.aborted) throw error;
        metrics.apiFailed++;
        failures.push({
          stage: "GetOwnerDetail",
          route: unit.routeLabel,
          routeValue: unit.routeValue,
          door: unit.householdLabel,
          etr_idx: unit.params.etrIdx,
          owner_idx: unit.params.ownerIdx,
          attempts: error?.attempts || apiAttempts || 3,
          reason: error?.message || "GetOwnerDetail 失敗",
          usedDateFallback: unit.usedDateFallback,
          timestamp: new Date().toISOString()
        });
      }

      metrics.processedHouseholds = index + 1;
      databaseProgress(metrics, { phase: "查詢 API" });
      if (index + 1 < units.length) await waitWithSignal(CONFIG.DATABASE_API_GAP_MS, signal);
    }

    databaseExtractorState.lastFailures = failures;
    const validUrlsBeforeExport = records
      .map((record) => record["PDF URL"])
      .filter(isValidPdfHref);
    const exported = exportPdfResults(validUrlsBeforeExport, failures, community);
    metrics.duplicateSkipped += validUrlsBeforeExport.length - exported.pdfUrls.length;
    metrics.validPdf = exported.pdfUrls.length;
    completionText = [
      `掃描棟別：${metrics.totalGroups}`,
      `掃描路段：${metrics.totalRoutes}`,
      `成功路段：${metrics.successfulRoutes}`,
      `空白路段：${metrics.emptyRoutes}`,
      `戶別總數：${metrics.totalHouseholds}`,
      `API成功：${metrics.apiSuccess}`,
      `API失敗：${metrics.apiFailed}`,
      `有效PDF：${metrics.validPdf}`,
      `重複略過：${metrics.duplicateSkipped}`,
      `篩選排除：${metrics.filteredSkipped}`
    ].join("\n");
    databaseProgress(metrics, { phase: "資料庫建立完成" });
  } catch (error) {
    databaseExtractorState.lastFailures = failures;
    if (error?.name === "AbortError" || signal.aborted) {
      completionText = `資料庫掃描已取消\n已處理戶別：${metrics.processedHouseholds} / ${metrics.totalHouseholds}`;
      databaseProgress(metrics, { phase: "已取消" });
    } else {
      completionText = `資料庫掃描中止：${error?.message || "未知錯誤"}`;
      log("PDF 資料庫掃描中止", error);
      databaseProgress(metrics, { phase: "掃描中止" });
    }
  } finally {
    controller.abort();
    databaseExtractorState.abortController = null;
    databaseExtractorState.running = false;
    databaseExtractorState.cancelRequested = false;
    STATE.acting = false;
    setPanelWorking(false, completionText);
    restoreButtons(buttonStates);
  }

  return { records, failures, metrics };
}
