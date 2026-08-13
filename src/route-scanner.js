import { CONFIG, sleep, log } from "./config.js";
import { isVisible, pageIsBusy } from "./utils.js";

const ROUTE_SELECT_SELECTOR = "select#selBARoad";
// 棟別／分期選單（圖中的「未歸類 / 第一期A…」）在不同社區的 id 不一定相同，
// 先試已知 id，再用結構推導：與路段選單同一列、排在它前面的那個 select。
const GROUP_SELECT_SELECTOR = [
  "select#selBAClass", // 實測確認：is.ycut.com.tw/magent/Community.aspx 的棟別／分期選單
  "select#selBAPart",
  "select#selBAStage",
  "select#selBAGroup",
  "select#selBABuild",
  "select#selBABuilding",
  "select#selBASection"
].join(", ");
const PANEL_SELECTOR = "#ycut-blue-user-panel";
const TABLE_SELECTOR = "table#BuAddr";
const TABLE_CONTAINER_SELECTOR = "#CommunityCase";
const OWNER_LINK_SELECTOR = "[onclick*='checkAndShowCommunityOwnerAddr']";
const EMPTY_TEXT_PATTERN = /查無(任何)?資料|無任何資料|尚無資料|沒有資料|無符合資料/;

function abortError() {
  return new DOMException("掃描已取消", "AbortError");
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

export function getRouteSelect() {
  return document.querySelector(ROUTE_SELECT_SELECTOR);
}

let cachedGroupSelect = null;

/**
 * 找出棟別／分期選單。先用已知 id，找不到就從路段選單往上找同一列的其他 select。
 * 排除本擴充自己的面板與隱藏、選項不足兩個的下拉。
 */
export function getGroupSelect() {
  if (cachedGroupSelect?.isConnected) return cachedGroupSelect;
  cachedGroupSelect = null;

  const known = document.querySelector(GROUP_SELECT_SELECTOR);
  if (known) {
    cachedGroupSelect = known;
    log("棟別選單（已知 id）：", known.id || known.name);
    return known;
  }

  const route = getRouteSelect();
  if (!route) return null;

  let scope = route.parentElement;
  for (let depth = 0; depth < 4 && scope; depth++) {
    const candidates = Array.from(scope.querySelectorAll("select")).filter((select) => (
      select !== route
      && !select.closest(PANEL_SELECTOR)
      && !select.disabled
      && isVisible(select)
      && getValidSelectOptions(select).length >= 2
    ));
    if (candidates.length) {
      // 取文件順序上排在路段選單前面、且最靠近的那一個
      const preceding = candidates.filter((select) => (
        select.compareDocumentPosition(route) & Node.DOCUMENT_POSITION_FOLLOWING
      ));
      cachedGroupSelect = preceding.length ? preceding[preceding.length - 1] : candidates[0];
      log("棟別選單（結構推導）：", cachedGroupSelect.id || cachedGroupSelect.name || cachedGroupSelect.outerHTML.slice(0, 80));
      return cachedGroupSelect;
    }
    scope = scope.parentElement;
  }

  log("找不到棟別選單，只掃描路段");
  return null;
}

function isPlaceholderOption(option) {
  const value = String(option?.value || "").trim();
  const text = String(option?.textContent || "").replace(/\s+/g, " ").trim();
  if (!value || !text) return true;
  if (option.disabled || option.hidden || option.dataset?.placeholder === "true") return true;
  return /^(請選擇|請選|選擇)?\s*(路段|分頁)\s*$/.test(text);
}

export function getValidSelectOptions(select) {
  if (!select) return [];
  const seenValues = new Set();
  return Array.from(select.options)
    .filter((option) => !isPlaceholderOption(option))
    .map((option) => ({
      value: String(option.value),
      label: String(option.textContent || "").replace(/\s+/g, " ").trim()
    }))
    .filter((option) => {
      if (seenValues.has(option.value)) return false;
      seenValues.add(option.value);
      return true;
    });
}

export function getValidRouteOptions(select = getRouteSelect()) {
  return getValidSelectOptions(select);
}

export function getValidGroupOptions(select = getGroupSelect()) {
  return getValidSelectOptions(select);
}

function getRouteOptionsFingerprint() {
  const select = getRouteSelect();
  if (!select) return "";
  return Array.from(select.options)
    .map((option) => `${option.value}:${(option.textContent || "").replace(/\s+/g, " ").trim()}`)
    .join("|");
}

/**
 * 判斷目前畫面是不是「這個路段沒有任何可掃描的戶別」。
 * explicit=true 代表頁面明講「查無資料」，可以馬上下結論；
 * explicit=false 代表只是找不到小藍人，必須等寬限期，避免把「還在載入」誤判成「空的」。
 */
export function detectRouteEmptyState() {
  const container = document.querySelector(TABLE_CONTAINER_SELECTOR);
  if ((container || document).querySelector(OWNER_LINK_SELECTOR)) {
    return { empty: false, explicit: false };
  }
  if (pageIsBusy()) return { empty: false, explicit: false };
  const text = (container?.innerText || "").replace(/\s+/g, "");
  return { empty: true, explicit: EMPTY_TEXT_PATTERN.test(text) };
}

function getTableSignature() {
  const container = document.querySelector(TABLE_CONTAINER_SELECTOR);
  const table = document.querySelector(TABLE_SELECTOR);
  if (!container || !table) return "";
  const headers = Array.from(table.querySelectorAll("th"))
    .map((cell) => (cell.childNodes[0]?.textContent || cell.textContent || "").replace(/\s+/g, " ").trim())
    .join("|");
  const households = Array.from(container.querySelectorAll("td"))
    .map((cell) => {
      const owners = Array.from(cell.querySelectorAll("[onclick*='checkAndShowCommunityOwnerAddr']"))
        .map((link) => link.getAttribute("onclick") || "")
        .join(",");
      const area = cell.querySelector(".ETRPin")?.textContent?.trim() || "";
      return `${cell.className}:${area}:${owners}`;
    })
    .join("|");
  return `${headers}::${households}`;
}

function mutationTouchesTable(mutation) {
  const currentContainer = document.querySelector(TABLE_CONTAINER_SELECTOR);
  if (currentContainer && (mutation.target === currentContainer || currentContainer.contains(mutation.target))) return true;
  return Array.from(mutation.addedNodes).concat(Array.from(mutation.removedNodes)).some((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    return node.matches?.(TABLE_CONTAINER_SELECTOR) || node.querySelector?.(TABLE_CONTAINER_SELECTOR);
  });
}

export function waitForTableRefresh({
  targetValue,
  previousTable,
  previousSignature,
  timeout = CONFIG.ROUTE_REFRESH_TIMEOUT_MS,
  signal
}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const observedRoot = document.querySelector(TABLE_CONTAINER_SELECTOR)?.parentElement || document.body;
    let sawRelevantMutation = false;
    let stableMarker = "";
    let stableSince = 0;
    let settled = false;
    let observer;
    let pollTimer;
    let timeoutTimer;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value || { empty: false, explicit: false });
    };
    const onAbort = () => finish(abortError());

    const reset = () => {
      stableMarker = "";
      stableSince = 0;
    };

    // marker 一變就重新計時，所以「無資料」狀態也必須維持穩定才會放行
    const settleOn = (marker, requiredMs, value) => {
      if (marker !== stableMarker) {
        stableMarker = marker;
        stableSince = Date.now();
        return;
      }
      if (Date.now() - stableSince >= requiredMs) finish(null, value);
    };

    const check = () => {
      const select = getRouteSelect();
      const table = document.querySelector(TABLE_SELECTOR);
      const signature = getTableSignature();
      const routeIsSelected = !!select && select.value === targetValue;
      const domWasRefreshed = sawRelevantMutation || table !== previousTable || signature !== previousSignature;
      if (!routeIsSelected || pageIsBusy()) {
        reset();
        return;
      }
      if (table && signature && domWasRefreshed) {
        settleOn(`DATA:${signature}`, CONFIG.ROUTE_SETTLE_MS, { empty: false, explicit: false });
        return;
      }
      // 沒有表格、或表格跟上一個路段一模一樣（連續兩個空白路段時會發生）
      const emptyState = detectRouteEmptyState();
      if (!emptyState.empty) {
        reset();
        return;
      }
      settleOn(
        `EMPTY:${emptyState.explicit}:${signature}`,
        emptyState.explicit ? CONFIG.ROUTE_SETTLE_MS : CONFIG.ROUTE_EMPTY_GRACE_MS,
        { empty: true, explicit: emptyState.explicit }
      );
    };

    try {
      throwIfAborted(signal);
      observer = new MutationObserver((mutations) => {
        if (mutations.some(mutationTouchesTable)) sawRelevantMutation = true;
        check();
      });
      observer.observe(observedRoot, { childList: true, subtree: true, characterData: true });
      pollTimer = setInterval(check, 120);
      timeoutTimer = setTimeout(() => {
        finish(new Error(`等待路段表格更新逾時（${Math.round((Date.now() - startedAt) / 1000)} 秒）`));
      }, timeout);
      signal?.addEventListener("abort", onAbort, { once: true });
      check();
    } catch (error) {
      finish(error);
    }
  });
}

/**
 * 切換棟別後要等的是「路段選單被重新填好」＋「表格跟著換掉」。
 * 兩個棟別的路段清單有可能一模一樣，所以完全沒變化時也要在寬限期後放行，不能無限等。
 */
export function waitForGroupRefresh({
  targetValue,
  previousRouteFingerprint,
  previousTable,
  previousSignature,
  timeout = CONFIG.ROUTE_REFRESH_TIMEOUT_MS,
  signal
}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let stableMarker = "";
    let stableSince = 0;
    let settled = false;
    let pollTimer;
    let timeoutTimer;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value || { changed: false });
    };
    const onAbort = () => finish(abortError());

    const check = () => {
      const group = getGroupSelect();
      if (!group || String(group.value) !== String(targetValue) || pageIsBusy()) {
        stableMarker = "";
        stableSince = 0;
        return;
      }
      const routeFingerprint = getRouteOptionsFingerprint();
      const table = document.querySelector(TABLE_SELECTOR);
      const signature = getTableSignature();
      const changed = routeFingerprint !== previousRouteFingerprint
        || table !== previousTable
        || signature !== previousSignature;
      const marker = `${routeFingerprint}::${signature}`;
      if (marker !== stableMarker) {
        stableMarker = marker;
        stableSince = Date.now();
        return;
      }
      const requiredMs = changed ? CONFIG.ROUTE_SETTLE_MS : CONFIG.ROUTE_EMPTY_GRACE_MS;
      if (Date.now() - stableSince >= requiredMs) finish(null, { changed, routeFingerprint });
    };

    try {
      throwIfAborted(signal);
      pollTimer = setInterval(check, 120);
      timeoutTimer = setTimeout(() => {
        finish(new Error(`等待棟別切換逾時（${Math.round((Date.now() - startedAt) / 1000)} 秒）`));
      }, timeout);
      signal?.addEventListener("abort", onAbort, { once: true });
      check();
    } catch (error) {
      finish(error);
    }
  });
}

export async function switchGroupAndWait(
  group,
  timeout = CONFIG.ROUTE_REFRESH_TIMEOUT_MS,
  signal,
  { forceRefresh = false } = {}
) {
  throwIfAborted(signal);
  const select = getGroupSelect();
  if (!select) throw new Error("找不到棟別／分期選單");
  if (!Array.from(select.options).some((option) => String(option.value) === String(group.value) && !option.disabled)) {
    throw new Error(`棟別選項已不存在：${group.label}`);
  }
  if (String(select.value) === String(group.value) && !forceRefresh) return { changed: false };

  const previousRouteFingerprint = getRouteOptionsFingerprint();
  const previousTable = document.querySelector(TABLE_SELECTOR);
  const previousSignature = getTableSignature();
  select.value = group.value;
  if (String(select.value) !== String(group.value)) throw new Error(`無法切換到棟別：${group.label}`);

  const refreshPromise = waitForGroupRefresh({
    targetValue: group.value,
    previousRouteFingerprint,
    previousTable,
    previousSignature,
    timeout,
    signal
  });
  select.dispatchEvent(new Event("change", { bubbles: true }));
  const result = await refreshPromise;
  throwIfAborted(signal);

  const currentSelect = getGroupSelect();
  if (!currentSelect || String(currentSelect.value) !== String(group.value)) {
    throw new Error(`棟別切換後 value 不符：${group.label}`);
  }
  return result;
}

export async function restoreOriginalGroup(originalValue, timeout = CONFIG.ROUTE_REFRESH_TIMEOUT_MS) {
  if (originalValue == null) return;
  const select = getGroupSelect();
  if (!select || String(select.value) === String(originalValue)) return;
  const option = Array.from(select.options).find((item) => String(item.value) === String(originalValue));
  if (!option) return;
  await switchGroupAndWait({ value: originalValue, label: option.textContent?.trim() || originalValue }, timeout);
  await sleep(0);
}

export async function switchRouteAndWait(
  route,
  timeout = CONFIG.ROUTE_REFRESH_TIMEOUT_MS,
  signal,
  { forceRefresh = false } = {}
) {
  throwIfAborted(signal);
  const select = getRouteSelect();
  if (!select) throw new Error(`找不到路段選單：${ROUTE_SELECT_SELECTOR}`);
  if (!Array.from(select.options).some((option) => option.value === route.value && !option.disabled)) {
    throw new Error(`路段選項已不存在：${route.label}`);
  }
  if (select.value === route.value && !forceRefresh) return detectRouteEmptyState();

  const previousTable = document.querySelector(TABLE_SELECTOR);
  const previousSignature = getTableSignature();
  select.value = route.value;
  if (select.value !== route.value) throw new Error(`無法切換到路段：${route.label}`);

  const refreshPromise = waitForTableRefresh({ targetValue: route.value, previousTable, previousSignature, timeout, signal });
  select.dispatchEvent(new Event("change", { bubbles: true }));
  const refreshResult = await refreshPromise;
  throwIfAborted(signal);

  const currentSelect = getRouteSelect();
  if (!currentSelect || currentSelect.value !== route.value) throw new Error(`路段切換後 value 不符：${route.label}`);
  return refreshResult;
}

export async function restoreOriginalRoute(originalValue, timeout = CONFIG.ROUTE_REFRESH_TIMEOUT_MS) {
  if (originalValue == null) return;
  const select = getRouteSelect();
  if (!select || !Array.from(select.options).some((option) => option.value === originalValue)) return;
  const option = Array.from(select.options).find((item) => item.value === originalValue);
  await switchRouteAndWait({ value: originalValue, label: option?.textContent?.trim() || originalValue }, timeout);
  await sleep(0);
}

function decorateRoutes(routes, group) {
  return routes.map((route) => ({
    ...route,
    groupValue: group.value,
    groupLabel: group.label || "",
    // displayLabel 只給顯示與匯出用；route.label 保持原樣，
    // 否則 database-scanner 的 routeDoorplateRange() 會把棟別裡的數字誤判成門牌範圍
    displayLabel: group.label ? `${group.label}／${route.label}` : route.label
  }));
}

export async function scanAllRoutePages({
  onRoute,
  onRouteStart,
  onRouteComplete,
  onRouteError,
  onGroupStart,
  onGroupError,
  onBeforeRestore,
  onRestored,
  onRestoreError,
  loadRoute,
  loadGroup,
  includeGroups = true,
  routeTimeout = CONFIG.ROUTE_REFRESH_TIMEOUT_MS,
  signal
} = {}) {
  const initialSelect = getRouteSelect();
  const originalValue = initialSelect?.value ?? null;
  const groupSelect = includeGroups ? getGroupSelect() : null;
  const originalGroupValue = groupSelect?.value ?? null;
  const groups = getValidGroupOptions(groupSelect);
  const effectiveGroups = groups.length
    ? groups
    : [{ value: originalGroupValue ?? "", label: "", currentOnly: true }];

  const results = [];
  const failures = [];
  const emptyRoutes = [];
  const groupFailures = [];
  const scannedRoutes = [];
  let globalRouteNumber = 0;

  try {
    for (let groupIndex = 0; groupIndex < effectiveGroups.length; groupIndex++) {
      throwIfAborted(signal);
      const group = effectiveGroups[groupIndex];
      const groupContext = {
        group,
        groupIndex,
        groupNumber: groupIndex + 1,
        totalGroups: effectiveGroups.length
      };
      onGroupStart?.(groupContext);

      let effectiveRoutes;
      try {
        if (!group.currentOnly) {
          if (loadGroup) await loadGroup({ ...groupContext, routeTimeout, signal });
          else await switchGroupAndWait(group, routeTimeout, signal);
        }
        throwIfAborted(signal);
        // 棟別換掉之後路段選單會被重新填，一定要重讀
        const routes = getValidRouteOptions();
        effectiveRoutes = decorateRoutes(
          routes.length
            ? routes
            : [{ value: getRouteSelect()?.value || originalValue || "", label: "目前畫面", currentOnly: true }],
          group
        );
      } catch (error) {
        if (error?.name === "AbortError" || signal?.aborted) throw error;
        const failure = {
          route: group.label || "（棟別）",
          value: group.value,
          stage: "group",
          reason: `棟別切換失敗：${error?.message || "未知錯誤"}`
        };
        groupFailures.push(failure);
        failures.push(failure);
        onGroupError?.({ ...groupContext, error, failure });
        continue;
      }

      for (let index = 0; index < effectiveRoutes.length; index++) {
        throwIfAborted(signal);
        const route = effectiveRoutes[index];
        globalRouteNumber++;
        scannedRoutes.push(route);
        const context = {
          ...groupContext,
          route,
          index,
          routeNumber: index + 1,
          totalRoutes: effectiveRoutes.length,
          globalRouteNumber
        };
        onRouteStart?.(context);
        try {
          let load = null;
          if (!route.currentOnly) {
            load = loadRoute
              ? await loadRoute({ ...context, routeTimeout, signal })
              : await switchRouteAndWait(route, routeTimeout, signal);
          }
          throwIfAborted(signal);
          if (load?.empty) emptyRoutes.push({ route: route.displayLabel, value: route.value });
          const routeContext = { ...context, load, isEmptyRoute: !!load?.empty };
          const value = await onRoute?.(routeContext);
          results.push({ ...routeContext, value });
          onRouteComplete?.({ ...routeContext, value });
        } catch (error) {
          if (error?.name === "AbortError" || signal?.aborted) throw error;
          const failure = {
            route: route.displayLabel,
            value: route.value,
            reason: error?.message || "路段掃描失敗"
          };
          failures.push(failure);
          onRouteError?.({ ...context, error, failure });
        }
      }
    }
    return {
      groups: effectiveGroups,
      groupCount: effectiveGroups.length,
      groupFailures,
      routes: scannedRoutes,
      routeCount: scannedRoutes.length,
      successfulRoutes: results.length,
      results,
      failures,
      emptyRoutes,
      emptyRouteCount: emptyRoutes.length,
      originalValue,
      originalGroupValue
    };
  } finally {
    try {
      await onBeforeRestore?.();
    } catch (error) {
      log("路段恢復前清理失敗", error);
      onRestoreError?.(error);
    }
    try {
      // 先還原棟別，路段選單才會回到原本的清單
      if (groupSelect && originalGroupValue != null) await restoreOriginalGroup(originalGroupValue, routeTimeout);
    } catch (error) {
      log("恢復原始棟別失敗", error);
      onRestoreError?.(error);
    }
    try {
      if (initialSelect && originalValue != null) await restoreOriginalRoute(originalValue, routeTimeout);
    } catch (error) {
      log("恢復原始路段失敗", error);
      onRestoreError?.(error);
    }
    try {
      await onRestored?.();
    } catch (error) {
      log("路段恢復後重新掃描失敗", error);
      onRestoreError?.(error);
    }
  }
}

export const ROUTE_SELECT = ROUTE_SELECT_SELECTOR;
export const TABLE_CONTAINER = TABLE_CONTAINER_SELECTOR;
