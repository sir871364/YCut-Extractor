import { CONFIG, sleep, log } from "./config.js";
import { pageIsBusy } from "./utils.js";

const ROUTE_SELECT_SELECTOR = "select#selBARoad";
const TABLE_SELECTOR = "table#BuAddr";
const TABLE_CONTAINER_SELECTOR = "#CommunityCase";

function abortError() {
  return new DOMException("掃描已取消", "AbortError");
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

export function getRouteSelect() {
  return document.querySelector(ROUTE_SELECT_SELECTOR);
}

function isPlaceholderOption(option) {
  const value = String(option?.value || "").trim();
  const text = String(option?.textContent || "").replace(/\s+/g, " ").trim();
  if (!value || !text) return true;
  if (option.disabled || option.hidden || option.dataset?.placeholder === "true") return true;
  return /^(請選擇|請選|選擇)?\s*(路段|分頁)\s*$/.test(text);
}

export function getValidRouteOptions(select = getRouteSelect()) {
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
    let stableSignature = "";
    let stableSince = 0;
    let settled = false;
    let observer;
    let pollTimer;
    let timeoutTimer;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(true);
    };
    const onAbort = () => finish(abortError());

    const check = () => {
      const select = getRouteSelect();
      const table = document.querySelector(TABLE_SELECTOR);
      const signature = getTableSignature();
      const routeIsSelected = !!select && select.value === targetValue;
      const domWasRefreshed = sawRelevantMutation || table !== previousTable || signature !== previousSignature;
      if (!routeIsSelected || !table || !signature || !domWasRefreshed || pageIsBusy()) {
        stableSignature = "";
        stableSince = 0;
        return;
      }
      if (signature !== stableSignature) {
        stableSignature = signature;
        stableSince = Date.now();
        return;
      }
      if (Date.now() - stableSince >= CONFIG.ROUTE_SETTLE_MS) finish();
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
  if (select.value === route.value && !forceRefresh) return true;

  const previousTable = document.querySelector(TABLE_SELECTOR);
  const previousSignature = getTableSignature();
  select.value = route.value;
  if (select.value !== route.value) throw new Error(`無法切換到路段：${route.label}`);

  const refreshPromise = waitForTableRefresh({ targetValue: route.value, previousTable, previousSignature, timeout, signal });
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await refreshPromise;
  throwIfAborted(signal);

  const currentSelect = getRouteSelect();
  if (!currentSelect || currentSelect.value !== route.value) throw new Error(`路段切換後 value 不符：${route.label}`);
  return true;
}

export async function restoreOriginalRoute(originalValue, timeout = CONFIG.ROUTE_REFRESH_TIMEOUT_MS) {
  if (originalValue == null) return;
  const select = getRouteSelect();
  if (!select || !Array.from(select.options).some((option) => option.value === originalValue)) return;
  const option = Array.from(select.options).find((item) => item.value === originalValue);
  await switchRouteAndWait({ value: originalValue, label: option?.textContent?.trim() || originalValue }, timeout);
  await sleep(0);
}

export async function scanAllRoutePages({
  onRoute,
  onRouteStart,
  onRouteComplete,
  onRouteError,
  onBeforeRestore,
  onRestored,
  onRestoreError,
  loadRoute,
  routeTimeout = CONFIG.ROUTE_REFRESH_TIMEOUT_MS,
  signal
} = {}) {
  const initialSelect = getRouteSelect();
  const originalValue = initialSelect?.value ?? null;
  const routes = getValidRouteOptions(initialSelect);
  const effectiveRoutes = routes.length
    ? routes
    : [{ value: originalValue || "", label: "目前畫面", currentOnly: true }];
  const results = [];
  const failures = [];

  try {
    for (let index = 0; index < effectiveRoutes.length; index++) {
      throwIfAborted(signal);
      const route = effectiveRoutes[index];
      const context = { route, index, routeNumber: index + 1, totalRoutes: effectiveRoutes.length };
      onRouteStart?.(context);
      try {
        if (!route.currentOnly) {
          if (loadRoute) await loadRoute({ ...context, routeTimeout, signal });
          else await switchRouteAndWait(route, routeTimeout, signal);
        }
        throwIfAborted(signal);
        const value = await onRoute?.(context);
        results.push({ ...context, value });
        onRouteComplete?.({ ...context, value });
      } catch (error) {
        if (error?.name === "AbortError" || signal?.aborted) throw error;
        const failure = { route: route.label, value: route.value, reason: error?.message || "路段掃描失敗" };
        failures.push(failure);
        onRouteError?.({ ...context, error, failure });
      }
    }
    return {
      routes: effectiveRoutes,
      routeCount: effectiveRoutes.length,
      successfulRoutes: results.length,
      results,
      failures,
      originalValue
    };
  } finally {
    try {
      await onBeforeRestore?.();
    } catch (error) {
      log("路段恢復前清理失敗", error);
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
