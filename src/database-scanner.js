import { CONFIG, log, sleep } from "./config.js";
import { STATE, anyExtractorRunning, databaseExtractorState } from "./state.js";
import { scan } from "./scanner.js";
import {
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

function doorplateForCell(cell) {
  const tables = [cell.closest("table"), document.querySelector("table#BuAddr")]
    .filter((table, index, items) => table && items.indexOf(table) === index);
  for (const table of tables) {
    for (const row of Array.from(table.rows || [])) {
      const header = row.cells?.[cell.cellIndex];
      if (!header || header === cell) continue;
      const text = (header.childNodes?.[0]?.textContent || header.textContent || "")
        .replace(/^選\s*/, "")
        .replace(/\s+/g, " ")
        .trim();
      if (text.includes("號")) return text;
    }
  }
  return "";
}

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
  const cells = document.querySelectorAll("#CommunityCase td");
  for (const cell of cells) {
    const links = Array.from(cell.querySelectorAll("ul.dropdown-menu li a[onclick*='checkAndShowCommunityOwnerAddr']"));
    if (!links.length) continue;
    const candidates = links.map(parseOwnerLinkParams).filter(Boolean);
    const selected = selectLatestOwnerParams(candidates);
    if (!selected) continue;

    const doorplate = doorplateForCell(cell);
    const floor = floorForCell(cell);
    const householdLabel = [doorplate, floor].filter(Boolean).join(" ")
      || (cell.textContent || "").replace(/\s+/g, " ").trim()
      || `${route.label} 戶別`;
    const householdKey = candidates
      .map((item) => `${item.etrIdx}:${item.ownerIdx}`)
      .sort()
      .join("|");

    units.push({
      routeLabel: route.label,
      routeValue: route.value,
      routeNumber,
      doorplate,
      floor,
      householdLabel,
      householdKey: householdKey || `${route.value}:${householdLabel}`,
      params: selected.params,
      usedDateFallback: selected.usedDateFallback
    });
  }
  return units;
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
        return { currentFingerprint: fingerprint, rowCount: rows.length };
      }
    } else {
      stableCount = 0;
      lastFingerprint = fingerprint;
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
      await waitForHouseholdListStable({
        previousFingerprint,
        requireChange,
        signal
      });
      return true;
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      lastError = error;
    }
  }

  if (lastError) lastError.routeAttempts = maxAttempts;
  throw lastError || new Error(`路段載入失敗：${route.label}`);
}

function routeDoorplateRange(routeLabel) {
  const match = String(routeLabel || "").match(/(\d+)\s*[~～至到\-－]\s*(\d+)/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return { min: Math.min(first, second), max: Math.max(first, second) };
}

function doorplateNumber(doorplate) {
  const match = String(doorplate || "").match(/(\d+)(?:\s*之\s*\d+)?\s*號/);
  return match ? Number(match[1]) : null;
}

function snapshotButtonStates() {
  const ids = ["ycut-export-json", "ycut-build-database", "ycut-cancel-database", "ycut-export-failures"];
  return new Map(ids.map((id) => {
    const button = document.getElementById(id);
    return [id, button ? button.disabled : null];
  }));
}

function setDatabaseButtonsRunning(running) {
  const legacyButton = document.getElementById("ycut-export-json");
  const databaseButton = document.getElementById("ycut-build-database");
  const cancelButton = document.getElementById("ycut-cancel-database");
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

export async function buildPdfDatabase() {
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
    processedHouseholds: 0,
    totalHouseholds: 0,
    apiSuccess: 0,
    apiRetries: 0,
    apiFailed: 0,
    validPdf: 0,
    duplicateSkipped: 0
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
      loadRoute: async ({ route, routeTimeout, signal: routeSignal }) => {
        await loadDatabaseRouteWithRetry(route, {
          signal: routeSignal,
          routeTimeout
        });
      },
      onRouteStart: ({ routeNumber, totalRoutes }) => {
        metrics.routeNumber = routeNumber;
        metrics.totalRoutes = totalRoutes;
        databaseProgress(metrics, { phase: "切換路段" });
      },
      onRoute: async ({ route, routeNumber, totalRoutes }) => {
        throwIfAborted(signal);
        const selectedRouteValue = getRouteSelect()?.value ?? "";
        if (!route.currentOnly && selectedRouteValue !== route.value) {
          throw new Error(`路段切換失敗：預期 ${route.value}，實際 ${selectedRouteValue}`);
        }
        scan();
        const currentUnits = collectCurrentRouteHouseholds(route, routeNumber);
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
      `掃描路段：${metrics.totalRoutes}`,
      `成功路段：${metrics.successfulRoutes}`,
      `戶別總數：${metrics.totalHouseholds}`,
      `API成功：${metrics.apiSuccess}`,
      `API失敗：${metrics.apiFailed}`,
      `有效PDF：${metrics.validPdf}`,
      `重複略過：${metrics.duplicateSkipped}`
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
