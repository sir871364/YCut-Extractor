import { STATE } from "./state.js";
import { scan } from "./scanner.js";
import { applyHighlight } from "./highlight.js";
import { injectDoorplateCheckboxes, setAllDoorplateCheckboxes } from "./doorplate.js";
import { exportPdfLinksAsJson } from "./extractor.js";
import { requireLicenseForPremiumAction } from "./license.js";
import { mountPanel, setPanelStatus } from "./panel.js";
import { CONFIG } from "./config.js";

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
      exportPdfLinksAsJson({
        delayBetween: CONFIG.DELAY_BETWEEN_MS,
        collapseAfter: true,
        perItemTimeout: CONFIG.PER_ITEM_TIMEOUT_MS,
        retries: CONFIG.MAX_RETRIES_PER_ITEM
      });
    }
  });
}

chrome.runtime?.onMessage?.addListener?.((m) => {
  if (!m?.type) return;
  if (m.type === "YCUT_SCAN") { scan(); return true; }
  if (m.type === "YCUT_TOGGLE_HIGHLIGHT") { applyHighlight(!STATE.highlighted); return true; }
});

function init() {
  if (!location.href.includes("Community.aspx")) return;
  bindHotkeys();
  watchDom();
  mountPanelWithHandlers();
  scan();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
