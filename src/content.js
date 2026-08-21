import { STATE } from "./state.js";
import { scan } from "./scanner.js";
import { applyHighlight } from "./highlight.js";
import { injectDoorplateCheckboxes, setAllDoorplateCheckboxes } from "./doorplate.js";
import { cancelLegacyScan, scanAllRoutes } from "./extractor.js";
import { hasValidLicense, requireLicenseForPremiumAction } from "./license.js";
import { getScanAllGroups, mountPanel, setPanelStatus, setProgressMode } from "./panel.js";
import { CONFIG } from "./config.js";
import { buildPdfDatabase, cancelDatabaseScan, exportLastDatabaseFailures } from "./database-scanner.js";
import { databaseExtractorState, legacyExtractorState } from "./state.js";
import {
  DISCLAIMER_STORAGE_KEY,
  DISCLAIMER_VERSION,
  getDisclaimerAccepted
} from "./disclaimer.js";

let ycutInitialized = false;
let bootstrapPromise = null;
let authorizationRetryRequested = false;

function bindHotkeys() {
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && e.code === "KeyU") {
      e.preventDefault();
      mountPanelWithHandlers();
      applyHighlight(!STATE.highlighted);
    }
  });
}

let scanDebounce = null;

function watchDom() {
  if (STATE.observer) STATE.observer.disconnect();
  const ob = new MutationObserver(() => {
    clearTimeout(scanDebounce);
    scanDebounce = setTimeout(() => scan(), 150);
  });
  ob.observe(document.documentElement, { childList: true, subtree: true });
  STATE.observer = ob;
}

function mountPanelWithHandlers() {
  mountPanel({
    onScan: () => { scan(); setPanelStatus("已重新掃描"); },
    onHighlight: () => applyHighlight(!STATE.highlighted),
    onDoorplateToggle: (enabled) => injectDoorplateCheckboxes(enabled),
    onDoorplateAll: () => setAllDoorplateCheckboxes(true),
    onDoorplateNone: () => setAllDoorplateCheckboxes(false),
    onExport: async () => {
      if (!(await requireLicenseForPremiumAction())) return;
      setProgressMode("legacy");
      await scanAllRoutes({
        delayBetween: CONFIG.DELAY_BETWEEN_MS,
        collapseAfter: true,
        perItemTimeout: CONFIG.PER_ITEM_TIMEOUT_MS,
        retries: CONFIG.MAX_RETRIES_PER_ITEM,
        includeGroups: getScanAllGroups()
      });
    },
    onBuildDatabase: async () => {
      if (!(await requireLicenseForPremiumAction())) return;
      await buildPdfDatabase({ includeGroups: getScanAllGroups() });
    },
    // 同一顆按鈕負責兩種掃描，看哪個在跑就取消哪個
    onCancelScan: () => {
      if (databaseExtractorState.running) cancelDatabaseScan();
      if (legacyExtractorState.running) cancelLegacyScan();
    },
    onExportFailures: async () => {
      // 匯出失敗清單也是一種將資料寫出檔案的動作，同樣受停用控制
      if (!(await requireLicenseForPremiumAction())) return;
      exportLastDatabaseFailures();
    }
  });
}

function bindRuntimeMessages() {
  chrome.runtime?.onMessage?.addListener?.((m) => {
    if (!m?.type) return;
    if (m.type === "YCUT_SCAN") { scan(); return true; }
    if (m.type === "YCUT_TOGGLE_HIGHLIGHT") { applyHighlight(!STATE.highlighted); return true; }
  });
}

export async function initializeYCutExtractor() {
  if (ycutInitialized) return;
  if (!location.href.includes("Community.aspx")) return;
  ycutInitialized = true;
  chrome.runtime?.sendMessage?.({ type: "YCUT_AUTOCONFIRM" });
  bindHotkeys();
  bindRuntimeMessages();
  watchDom();
  mountPanelWithHandlers();
  scan();
}

export async function bootstrapYCutExtractor() {
  if (ycutInitialized) return;
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    if (!location.href.includes("Community.aspx")) return;

    let authorized = false;
    try {
      authorized = await hasValidLicense();
    } catch {
      authorized = false;
    }
    if (!authorized) return;

    const accepted = await getDisclaimerAccepted();
    if (!accepted) return;
    await initializeYCutExtractor();
  })();

  try {
    return await bootstrapPromise;
  } finally {
    bootstrapPromise = null;
    if (!ycutInitialized && authorizationRetryRequested) {
      authorizationRetryRequested = false;
      setTimeout(() => bootstrapYCutExtractor(), 0);
    } else {
      authorizationRetryRequested = false;
    }
  }
}

chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
  if (areaName !== "local") return;
  const licenseBecameValid = changes.license_status?.newValue === "valid";
  const disclaimerRecord = changes[DISCLAIMER_STORAGE_KEY]?.newValue;
  const disclaimerWasAccepted = disclaimerRecord?.accepted === true &&
    disclaimerRecord?.version === DISCLAIMER_VERSION;
  if (!licenseBecameValid && !disclaimerWasAccepted) return;
  authorizationRetryRequested = true;
  if (!bootstrapPromise && !ycutInitialized) {
    authorizationRetryRequested = false;
    bootstrapYCutExtractor();
  }
});

chrome.runtime?.onMessage?.addListener?.((message, sender, sendResponse) => {
  if (message?.type === "YCUT_GATE_PING") {
    sendResponse?.({ ok: true });
    return;
  }
  if (message?.type === "YCUT_DISCLAIMER_ACCEPTED") {
    bootstrapYCutExtractor().catch(() => {});
    sendResponse?.({ ok: true });
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => bootstrapYCutExtractor(), { once: true });
} else {
  bootstrapYCutExtractor();
}
