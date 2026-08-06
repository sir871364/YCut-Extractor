(() => {
  // src/state.js
  var STATE = {
    nodes: /* @__PURE__ */ new Set(),
    highlighted: false,
    observer: null,
    acting: false,
    extractStartedAt: 0,
    autoFollow: true,
    doorplateSelectEnabled: false,
    selectedColIdx: /* @__PURE__ */ new Set(),
    colIdxToDoorplate: /* @__PURE__ */ new Map()
  };
  var legacyExtractorState = {
    running: false
  };
  var databaseExtractorState = {
    running: false,
    cancelRequested: false,
    abortController: null,
    lastFailures: [],
    lastCommunityName: "community"
  };
  function anyExtractorRunning() {
    return legacyExtractorState.running || databaseExtractorState.running;
  }

  // src/config.js
  var SEL = {
    anchor: "a",
    iconUser: "i.icon.icon-user",
    dropdown: "ul.dropdown-menu"
  };
  var CONFIG = {
    DELAY_BETWEEN_MS: 2e3,
    PER_ITEM_TIMEOUT_MS: 3e4,
    MAX_RETRIES_PER_ITEM: 2,
    ROUTE_REFRESH_TIMEOUT_MS: 3e4,
    ROUTE_SETTLE_MS: 350,
    OWNER_API_TIMEOUT_MS: 15e3,
    OWNER_API_RETRY_DELAYS_MS: [800, 1500],
    DATABASE_API_GAP_MS: 100
  };
  var LICENSE_STATUS_API = "https://ycut-license-api.sir8713642.workers.dev/api/license-status";
  var PRODUCT_ID = "ycut_extractor";
  var COMM_GATEWAY_URL = "https://is.ycut.com.tw/magent/ashx/CommGateway.ashx";
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  var log = (...a) => console.log("[YCUT]", ...a);

  // src/utils.js
  function isVisible(el) {
    if (!el) return false;
    const st = getComputedStyle(el);
    return el.offsetParent !== null && st.visibility !== "hidden" && st.display !== "none";
  }
  async function waitFor(fn, { timeout = 4e3, interval = 80 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        const v = fn();
        if (v) return v;
      } catch {
      }
      await sleep(interval);
    }
    return null;
  }
  function pageIsBusy() {
    const selectors = [
      ".blockUI",
      ".ui-blockui",
      ".blockOverlay",
      ".blockMsg",
      ".loading",
      ".spinner",
      ".lds-spinner",
      ".modal:has(.loading)"
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const st = getComputedStyle(el);
        if (st.display !== "none" && st.visibility !== "hidden" && el.offsetParent !== null) return true;
      }
    }
    return (document.body.innerText || "").trim().includes("\u8CC7\u6599\u8B80\u53D6\u4E2D");
  }
  async function waitForPageIdle(timeout = 3e4, interval = 120) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (!pageIsBusy()) return true;
      await sleep(interval);
    }
    return false;
  }
  async function waitForPageBusyAppear(timeout = 2e3, interval = 80) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (pageIsBusy()) return true;
      await sleep(interval);
    }
    return false;
  }

  // src/highlight.js
  function applyHighlight(on) {
    STATE.nodes.forEach((a) => {
      if (on) {
        a.classList.add("ycut-blue-user-highlight");
        ensureBadge(a);
      } else {
        a.classList.remove("ycut-blue-user-highlight");
        removeBadge(a);
      }
    });
    STATE.highlighted = on;
  }
  function ensureBadge(anchor) {
    if (anchor._ycutBadge) return;
    if (getComputedStyle(anchor).position === "static") anchor.style.position = "relative";
    const badge = document.createElement("span");
    badge.className = "ycut-blue-user-badge";
    badge.textContent = "\u2713";
    anchor.appendChild(badge);
    anchor._ycutBadge = badge;
  }
  function removeBadge(anchor) {
    if (anchor._ycutBadge) {
      anchor._ycutBadge.remove();
      anchor._ycutBadge = null;
    }
  }

  // src/doorplate.js
  function getBuAddrTable() {
    return document.querySelector("table#BuAddr");
  }
  function buildDoorplateMap() {
    STATE.colIdxToDoorplate.clear();
    const table = getBuAddrTable();
    if (!table) return;
    Array.from(table.querySelectorAll("thead tr th")).forEach((th, idx) => {
      const text = (th.textContent || "").trim();
      if (text) STATE.colIdxToDoorplate.set(idx, text);
    });
  }
  function injectDoorplateCheckboxes(enable) {
    const table = getBuAddrTable();
    if (!table) return;
    const ths = Array.from(table.querySelectorAll("thead tr th"));
    if (!ths.length) return;
    buildDoorplateMap();
    ths.forEach((th, idx) => {
      const existed = th.querySelector("input.ycut-doorplate-cb");
      if (!enable) {
        if (existed) existed.closest("label")?.remove();
        th.style.position = "";
        th.style.paddingTop = "";
        return;
      }
      if (existed) return;
      th.style.position = "relative";
      th.style.paddingTop = "18px";
      const label = document.createElement("label");
      Object.assign(label.style, {
        position: "absolute",
        left: "6px",
        top: "2px",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "12px",
        userSelect: "none"
      });
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "ycut-doorplate-cb";
      cb.dataset.colIndex = String(idx);
      cb.checked = STATE.selectedColIdx.has(idx);
      cb.addEventListener("change", () => {
        const col = Number(cb.dataset.colIndex);
        if (cb.checked) STATE.selectedColIdx.add(col);
        else STATE.selectedColIdx.delete(col);
        updateSelectedDoorplateText();
      });
      const mini = document.createElement("span");
      mini.textContent = "\u9078";
      label.append(cb, mini);
      th.appendChild(label);
    });
    updateSelectedDoorplateText();
  }
  function setAllDoorplateCheckboxes(checked) {
    const table = getBuAddrTable();
    if (!table) return;
    STATE.selectedColIdx.clear();
    Array.from(table.querySelectorAll("input.ycut-doorplate-cb")).forEach((cb) => {
      cb.checked = checked;
      if (checked) STATE.selectedColIdx.add(Number(cb.dataset.colIndex));
    });
    updateSelectedDoorplateText();
  }
  function getDoorplateByColIndex(colIdx) {
    return STATE.colIdxToDoorplate.get(colIdx) || `col_${colIdx}`;
  }
  function updateSelectedDoorplateText() {
    const el = document.getElementById("ycut-doorplate-selected");
    if (!el) return;
    if (!STATE.doorplateSelectEnabled) {
      el.textContent = "\uFF08\u672A\u555F\u7528\uFF09";
      return;
    }
    if (STATE.selectedColIdx.size === 0) {
      el.textContent = "\uFF08\u672A\u52FE\u9078\uFF1D\u5168\u90E8\u9580\u724C\uFF09";
      return;
    }
    const names = Array.from(STATE.selectedColIdx).sort((a, b) => a - b).map(getDoorplateByColIndex);
    el.textContent = names.join("\u3001");
  }

  // src/panel.js
  function updatePanelCount() {
    const el = document.getElementById("ycut-count");
    if (el) el.textContent = String(STATE.nodes.size);
  }
  function setPanelStatus(text) {
    const el = document.getElementById("ycut-progress");
    if (el) el.textContent = text;
  }
  function ensureProgressUi() {
    const panel = document.getElementById("ycut-blue-user-panel");
    if (!panel) return null;
    let box = document.getElementById("ycut-progress-box");
    if (box) return box;
    box = document.createElement("div");
    box.id = "ycut-progress-box";
    box.innerHTML = `
    <div id="ycut-legacy-progress">
      <div id="ycut-route-current">\u6B63\u5728\u6383\u63CF\u8DEF\u6BB5\uFF1A-</div>
      <div class="ycut-route-meta">
        <span id="ycut-route-count">\u5206\u9801\u9032\u5EA6\uFF1A0 / 0</span>
        <span id="ycut-route-found">\u76EE\u524D\u627E\u5230\uFF1A0</span>
        <span id="ycut-route-failed">\u76EE\u524D\u5931\u6557\uFF1A0</span>
      </div>
    </div>
    <div id="ycut-database-progress" hidden>
      <div id="ycut-db-route">\u76EE\u524D\u8DEF\u6BB5\uFF1A0 / 0</div>
      <div class="ycut-database-meta">
        <span id="ycut-db-households">\u6383\u63CF\u6236\u5225\uFF1A0 / 0</span>
        <span id="ycut-db-success">API\u6210\u529F\uFF1A0</span>
        <span id="ycut-db-retries">API\u91CD\u8A66\uFF1A0</span>
        <span id="ycut-db-failed">API\u5931\u6557\uFF1A0</span>
        <span id="ycut-db-pdf">\u6709\u6548PDF\uFF1A0</span>
        <span id="ycut-db-duplicates">\u91CD\u8907\u7565\u904E\uFF1A0</span>
      </div>
    </div>
    <div class="ycut-progress-meta">
      <span id="ycut-progress-count">0/0</span>
      <span id="ycut-progress-eta">\u4F30\u7B97\u4E2D</span>
    </div>
    <div class="ycut-progress-track">
      <div id="ycut-progress-bar"></div>
    </div>
    <div id="ycut-progress-stage">\u72C0\u614B\uFF1A\u5F85\u547D</div>
  `;
    const progress = document.getElementById("ycut-progress");
    if (progress && progress.parentNode) {
      progress.parentNode.insertBefore(box, progress.nextSibling);
    } else {
      panel.appendChild(box);
    }
    return box;
  }
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function updateRouteProgress({ routeName = "-", index = 0, total = 0, found = 0, failed = 0 } = {}) {
    ensureProgressUi();
    setText("ycut-route-current", `\u6B63\u5728\u6383\u63CF\u8DEF\u6BB5\uFF1A${routeName}`);
    setText("ycut-route-count", `\u5206\u9801\u9032\u5EA6\uFF1A${index} / ${total}`);
    setText("ycut-route-found", `\u76EE\u524D\u627E\u5230\uFF1A${found}`);
    setText("ycut-route-failed", `\u76EE\u524D\u5931\u6557\uFF1A${failed}`);
  }
  function setProgressMode(mode) {
    ensureProgressUi();
    const database = mode === "database";
    const legacyBox = document.getElementById("ycut-legacy-progress");
    const databaseBox = document.getElementById("ycut-database-progress");
    if (legacyBox) legacyBox.hidden = database;
    if (databaseBox) databaseBox.hidden = !database;
  }
  function updateDatabaseProgress({
    routeNumber = 0,
    totalRoutes = 0,
    scannedHouseholds = 0,
    totalHouseholds = 0,
    apiSuccess = 0,
    apiRetries = 0,
    apiFailed = 0,
    validPdf = 0,
    duplicateSkipped = 0,
    phase = "\u6E96\u5099\u4E2D"
  } = {}) {
    ensureProgressUi();
    setText("ycut-db-route", `\u76EE\u524D\u8DEF\u6BB5\uFF1A${routeNumber} / ${totalRoutes}`);
    setText("ycut-db-households", `\u6383\u63CF\u6236\u5225\uFF1A${scannedHouseholds} / ${totalHouseholds}`);
    setText("ycut-db-success", `API\u6210\u529F\uFF1A${apiSuccess}`);
    setText("ycut-db-retries", `API\u91CD\u8A66\uFF1A${apiRetries}`);
    setText("ycut-db-failed", `API\u5931\u6557\uFF1A${apiFailed}`);
    setText("ycut-db-pdf", `\u6709\u6548PDF\uFF1A${validPdf}`);
    setText("ycut-db-duplicates", `\u91CD\u8907\u7565\u904E\uFF1A${duplicateSkipped}`);
    setText("ycut-progress-stage", `\u72C0\u614B\uFF1A${phase}`);
    const percent = totalHouseholds ? Math.round(scannedHouseholds / totalHouseholds * 100) : 0;
    setText("ycut-progress-count", `${scannedHouseholds}/${totalHouseholds} \xB7 ${percent}%`);
    setText("ycut-progress-eta", scannedHouseholds >= totalHouseholds && totalHouseholds > 0 ? "\u5B8C\u6210" : "\u8655\u7406\u4E2D");
    const bar = document.getElementById("ycut-progress-bar");
    if (bar) {
      bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
      bar.classList.toggle("is-complete", scannedHouseholds >= totalHouseholds && totalHouseholds > 0);
    }
  }
  function formatEta(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "\u4F30\u7B97\u4E2D";
    const sec = Math.ceil(ms / 1e3);
    if (sec < 60) return `\u7D04 ${sec} \u79D2`;
    const min = Math.floor(sec / 60);
    const remain = sec % 60;
    return remain ? `\u7D04 ${min} \u5206 ${remain} \u79D2` : `\u7D04 ${min} \u5206`;
  }
  function setPanelWorking(working, text) {
    STATE.acting = working;
    ensureProgressUi();
    const el = document.getElementById("ycut-progress");
    if (el) el.textContent = text || (working ? "\u57F7\u884C\u4E2D..." : "\u5F85\u547D");
    const box = document.getElementById("ycut-progress-box");
    if (box) box.classList.toggle("is-working", !!working);
  }
  function updatePanelProgress(done, total, detail = {}) {
    ensureProgressUi();
    const startedAt = detail.startedAt || STATE.extractStartedAt || Date.now();
    const percent = total ? Math.round(done / total * 100) : 0;
    const elapsed = Date.now() - startedAt;
    const eta = done > 0 && done < total ? formatEta(elapsed / done * (total - done)) : done >= total && total > 0 ? "\u5B8C\u6210" : "\u4F30\u7B97\u4E2D";
    const el = document.getElementById("ycut-progress");
    if (el) el.textContent = detail.title || "\u64F7\u53D6 PDF \u4E2D";
    setText("ycut-progress-count", `${done}/${total} \xB7 ${percent}%`);
    setText("ycut-progress-eta", eta);
    setText("ycut-progress-stage", `\u72C0\u614B\uFF1A${detail.stage || "\u57F7\u884C\u4E2D"}`);
    const bar = document.getElementById("ycut-progress-bar");
    if (bar) {
      bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
      bar.classList.toggle("is-complete", done >= total && total > 0);
    }
  }
  function resetPanelProgress(total, detail = {}) {
    STATE.extractStartedAt = Date.now();
    updatePanelProgress(0, total, {
      title: detail.title || "\u64F7\u53D6 PDF \u4E2D",
      current: detail.current || "-",
      stage: detail.stage || "\u6E96\u5099\u4E2D",
      startedAt: STATE.extractStartedAt
    });
  }
  function markAnchorExtractionState(anchor, state) {
    const cell = anchor?.closest?.("td");
    if (!cell) return;
    cell.classList.remove("ycut-extract-active", "ycut-extract-done", "ycut-extract-failed");
    if (state) cell.classList.add(`ycut-extract-${state}`);
  }
  function clearExtractionStates() {
    document.querySelectorAll(".ycut-extract-active,.ycut-extract-done,.ycut-extract-failed").forEach((el) => el.classList.remove("ycut-extract-active", "ycut-extract-done", "ycut-extract-failed"));
  }
  function mountPanel({
    onScan,
    onHighlight,
    onAutoFollow,
    onDoorplateToggle,
    onDoorplateAll,
    onDoorplateNone,
    onExport,
    onBuildDatabase,
    onCancelDatabase,
    onExportFailures
  }) {
    if (document.getElementById("ycut-blue-user-panel")) return;
    const panel = document.createElement("div");
    panel.id = "ycut-blue-user-panel";
    panel.innerHTML = `
    <h4>YCUT \u85CD\u8272\u5C0F\u4EBA\u6383\u63CF</h4>
    <div class="row"><span>\u627E\u5230\u6578\u91CF\uFF1A</span><span class="count" id="ycut-count">0</span></div>
    <div class="row">
      <span>\u5EFA\u576A\u7BE9\u9078\uFF1A</span>
      <input id="ycut-area-min" type="number" placeholder="\u6700\u5C0F" style="width:70px;padding:4px 6px;border-radius:6px;border:1px solid #555;background:#fff;color:#000;">
      <span>~</span>
      <input id="ycut-area-max" type="number" placeholder="\u6700\u5927" style="width:70px;padding:4px 6px;border-radius:6px;border:1px solid #555;background:#fff;color:#000;">
    </div>
    <div class="row" style="flex-direction:column;align-items:flex-start;gap:6px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button id="ycut-doorplate-toggle">\u9580\u724C\u52FE\u9078\uFF1A\u95DC</button>
        <button id="ycut-doorplate-all">\u5168\u9078</button>
        <button id="ycut-doorplate-none">\u5168\u4E0D\u9078</button>
      </div>
      <div class="muted" style="font-size:12px;">\u76EE\u524D\u52FE\u9078\uFF1A<span id="ycut-doorplate-selected">\uFF08\u672A\u555F\u7528\uFF09</span></div>
    </div>
    <div class="row">
      <button id="ycut-scan">\u91CD\u65B0\u6383\u63CF</button>
      <button id="ycut-highlight">\u5207\u63DB\u9AD8\u4EAE</button>
    </div>
    <div class="row">
      <button id="ycut-auto-follow">\u81EA\u52D5\u8DDF\u96A8\uFF1A\u958B</button>
      <button id="ycut-export-json">\u64F7\u53D6PDF\u2192JSON\u4E0B\u8F09</button>
    </div>
    <div class="row">
      <button id="ycut-build-database">\u5EFA\u7ACBPDF\u8CC7\u6599\u5EAB</button>
    </div>
    <div class="row">
      <button id="ycut-cancel-database" disabled>\u53D6\u6D88\u8CC7\u6599\u5EAB\u6383\u63CF</button>
      <button id="ycut-export-failures" disabled>\u532F\u51FA\u5931\u6557\u6E05\u55AE</button>
    </div>
    <div class="row">
      <button id="ycut-close">\u95DC\u9589\u9762\u677F</button>
    </div>
    <div id="ycut-progress" class="muted">\u5F85\u547D</div>
    <div style="font-size:12px;opacity:.75;margin-top:6px;">\u5FEB\u6377\u9375\uFF1AAlt+Shift+U \u9AD8\u4EAE</div>
  `;
    document.body.appendChild(panel);
    ensureProgressUi();
    panel.querySelector("#ycut-scan").addEventListener("click", onScan);
    panel.querySelector("#ycut-highlight").addEventListener("click", onHighlight);
    panel.querySelector("#ycut-auto-follow").addEventListener("click", () => {
      STATE.autoFollow = !STATE.autoFollow;
      panel.querySelector("#ycut-auto-follow").textContent = `\u81EA\u52D5\u8DDF\u96A8\uFF1A${STATE.autoFollow ? "\u958B" : "\u95DC"}`;
      onAutoFollow?.(STATE.autoFollow);
    });
    panel.querySelector("#ycut-export-json").addEventListener("click", onExport);
    panel.querySelector("#ycut-build-database").addEventListener("click", onBuildDatabase);
    panel.querySelector("#ycut-cancel-database").addEventListener("click", onCancelDatabase);
    panel.querySelector("#ycut-export-failures").addEventListener("click", onExportFailures);
    panel.querySelector("#ycut-close").addEventListener("click", () => panel.remove());
    panel.querySelector("#ycut-doorplate-toggle").addEventListener("click", () => {
      STATE.doorplateSelectEnabled = !STATE.doorplateSelectEnabled;
      panel.querySelector("#ycut-doorplate-toggle").textContent = `\u9580\u724C\u52FE\u9078\uFF1A${STATE.doorplateSelectEnabled ? "\u958B" : "\u95DC"}`;
      onDoorplateToggle(STATE.doorplateSelectEnabled);
    });
    panel.querySelector("#ycut-doorplate-all").addEventListener("click", () => {
      if (!STATE.doorplateSelectEnabled) {
        alert("\u8ACB\u5148\u628A\u300C\u9580\u724C\u52FE\u9078\u300D\u6253\u958B");
        return;
      }
      onDoorplateAll();
    });
    panel.querySelector("#ycut-doorplate-none").addEventListener("click", () => {
      if (!STATE.doorplateSelectEnabled) {
        alert("\u8ACB\u5148\u628A\u300C\u9580\u724C\u52FE\u9078\u300D\u6253\u958B");
        return;
      }
      onDoorplateNone();
    });
  }

  // src/scanner.js
  function findDropdownForAnchor(anchor) {
    if (!anchor) return null;
    const cell = anchor.closest("td");
    if (!cell) return null;
    return cell.querySelector(SEL.dropdown);
  }
  function isBlueClickableUser(anchor) {
    if (!anchor || anchor.tagName !== "A") return false;
    const icon = anchor.querySelector(SEL.iconUser);
    if (!icon) return false;
    if (getComputedStyle(icon).color === "rgb(187, 187, 187)") return false;
    return !!findDropdownForAnchor(anchor);
  }
  function scan() {
    const found = /* @__PURE__ */ new Set();
    document.querySelectorAll(SEL.anchor).forEach((a) => {
      if (isBlueClickableUser(a)) found.add(a);
    });
    STATE.nodes = found;
    log("\u6383\u63CF\u5B8C\u6210\uFF0C\u5019\u9078\u6578\uFF1A", STATE.nodes.size);
    updatePanelCount();
    if (STATE.highlighted) applyHighlight(true);
    if (STATE.doorplateSelectEnabled) injectDoorplateCheckboxes(true);
  }
  function getAreaFromAnchor(anchor) {
    try {
      const td = anchor.closest("td");
      if (!td) return null;
      const text = (td.textContent || "").replace(/,/g, "");
      const matches = text.match(/(\d+\.\d+|\d+)/g);
      if (!matches || !matches.length) return null;
      const val = parseFloat(matches[matches.length - 1]);
      return Number.isFinite(val) ? val : null;
    } catch {
      return null;
    }
  }
  function getAreaFilterFromPanel() {
    const minEl = document.getElementById("ycut-area-min");
    const maxEl = document.getElementById("ycut-area-max");
    let min = null;
    let max = null;
    if (minEl && minEl.value !== "") {
      const v = Number(minEl.value);
      if (Number.isFinite(v)) min = v;
    }
    if (maxEl && maxEl.value !== "") {
      const v = Number(maxEl.value);
      if (Number.isFinite(v)) max = v;
    }
    return { min, max };
  }

  // src/interactions.js
  function visibleModal() {
    const cands = Array.from(document.querySelectorAll('.modal, [role="dialog"]')).filter(isVisible);
    if (!cands.length) return null;
    for (const m of cands) if ((m.textContent || "").includes("\u6240\u6709\u6B0A\u4EBA\u660E\u7D30")) return m;
    return cands[0];
  }
  function firstOwnerLinkOf(anchor) {
    const dd = findDropdownForAnchor(anchor);
    if (!dd) return null;
    return dd.querySelector("li a, a");
  }
  async function clickOpen(anchor) {
    let dd = findDropdownForAnchor(anchor);
    try {
      anchor.scrollIntoView({ block: "center", inline: "center" });
    } catch {
    }
    anchor.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    anchor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await sleep(150);
    if (!dd) dd = findDropdownForAnchor(anchor);
    if (dd && isVisible(dd)) return true;
    try {
      anchor.click();
    } catch {
    }
    await sleep(150);
    if (!dd) dd = findDropdownForAnchor(anchor);
    return dd ? isVisible(dd) : true;
  }
  async function clickClose(anchor) {
    const dd = findDropdownForAnchor(anchor);
    if (!dd || !isVisible(dd)) return true;
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await sleep(120);
    if (!isVisible(dd)) return true;
    try {
      anchor.click();
    } catch {
    }
    await sleep(120);
    return !isVisible(dd);
  }
  function invokeJsHrefIfNeeded(linkEl) {
    if (!linkEl) return false;
    const hrefRaw = (linkEl.getAttribute("href") || "").trim();
    if (/^javascript:/i.test(hrefRaw)) {
      const js = hrefRaw.replace(/^javascript:/i, "").trim();
      const m = js.match(/__doPostBack\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/);
      if (m && typeof window.__doPostBack === "function") {
        window.__doPostBack(m[1], m[2]);
        return true;
      }
      if (typeof linkEl.onclick === "function") {
        linkEl.onclick.call(linkEl);
        return true;
      }
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
      linkEl.addEventListener("click", (e) => e.preventDefault(), { once: true, capture: true });
      linkEl.dispatchEvent(ev);
      return true;
    }
    try {
      linkEl.click();
      return true;
    } catch {
    }
    linkEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }
  async function clickFirstOwnerAndWaitModal(anchor) {
    await clickOpen(anchor);
    const link = firstOwnerLinkOf(anchor);
    if (!link) return { opened: false, modal: null };
    invokeJsHrefIfNeeded(link);
    await waitForPageBusyAppear(2e3);
    await waitForPageIdle(CONFIG.PER_ITEM_TIMEOUT_MS);
    const modal = await waitFor(() => {
      const m = visibleModal();
      if (m) return m;
      return document.querySelector("a#aPdf[href]") ? true : null;
    }, { timeout: 5e3, interval: 80 });
    return { opened: !!modal, modal: modal === true ? null : modal };
  }
  function modalCloseButton(modal) {
    if (!modal) return null;
    for (const b of modal.querySelectorAll("button, a")) {
      const t = (b.innerText || b.textContent || "").trim();
      if (t === "\u95DC\u9589" || t === "\u5173\u95ED" || t.toLowerCase() === "close") return b;
    }
    return modal.querySelector('.close, [data-dismiss="modal"], [aria-label="Close"]');
  }
  async function closeModal(modal) {
    if (!modal) return false;
    const btn = modalCloseButton(modal);
    if (btn) {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      const ok = await waitFor(() => !isVisible(modal), { timeout: 2500, interval: 80 });
      if (ok !== null) return true;
    }
    modal.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, which: 27, bubbles: true }));
    await sleep(150);
    return !isVisible(modal);
  }
  async function closeCurrentModalIfAny() {
    const modal = visibleModal();
    if (modal) await closeModal(modal);
  }
  async function closeAfterExtraction(anchor, modal) {
    if (modal) await closeModal(modal);
    await sleep(120);
    await clickClose(anchor);
  }

  // src/pdf.js
  function isValidPdfHref(href) {
    return typeof href === "string" && /\/ycut\/pdf\/.+\/\.pdf\/?$/i.test(href);
  }
  async function waitForValidPdfHref(modal, timeoutMs, previousHref = "") {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const local = modal?.querySelector?.("a#aPdf[href]");
      if (local && isValidPdfHref(local.href) && local.href !== previousHref) return local.href;
      const global = document.querySelector("a#aPdf[href]");
      if (global && isVisible(global) && isValidPdfHref(global.href) && global.href !== previousHref) return global.href;
      await sleep(120);
    }
    return null;
  }
  function extractPdfHrefFromModal(modal) {
    if (modal) {
      const a1 = modal.querySelector("a#aPdf[href]");
      if (a1 && isValidPdfHref(a1.href)) return a1.href;
      for (const a of modal.querySelectorAll("a[href]")) {
        const i = a.querySelector("i");
        if (i && /pdf/i.test(String(i.className)) && isValidPdfHref(a.href)) return a.href;
        const href = a.getAttribute("href") || "";
        if (isValidPdfHref(href)) return new URL(href, location.origin).href;
      }
    }
    const g = document.querySelector("a#aPdf[href]");
    if (g && isValidPdfHref(g.href)) return g.href;
    return null;
  }
  function parseOwnerParams(anchor) {
    const link = firstOwnerLinkOf(anchor);
    const onclick = link?.getAttribute("onclick") || "";
    const match = onclick.match(/checkAndShowCommunityOwnerAddr\((.*)\)/);
    if (!match) return null;
    const jsonish = `[${match[1].replace(/'/g, '"')}]`;
    try {
      const values = JSON.parse(jsonish);
      return {
        pdf: values[0] || "",
        etrIdx: String(values[1] || ""),
        ownerIdx: String(values[2] || ""),
        checkViewLog: values[3] === true,
        city: values[4] || "",
        district: values[5] || "",
        sessionId: values[6] || "",
        etrNo: values[7] || "",
        label: (link.textContent || "").trim()
      };
    } catch {
      return null;
    }
  }
  async function fetchOwnerDetail(params) {
    const res = await fetch(COMM_GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        Method: "GetOwnerDetail",
        Data: { Etr_idx: params.etrIdx, Owner_idx: params.ownerIdx }
      })
    });
    if (!res.ok) throw new Error(`CommGateway HTTP ${res.status}`);
    const result = await res.json();
    if (result.Status !== "1") throw new Error(result.Message || `CommGateway status ${result.Status}`);
    const detail = result.Data && result.Data[0];
    if (!detail) throw new Error("API \u56DE\u50B3\u7A7A\u8CC7\u6599");
    return detail;
  }
  async function getPdfByApi(anchor) {
    const params = parseOwnerParams(anchor);
    if (!params) throw new Error("\u627E\u4E0D\u5230\u5C0F\u85CD\u4EBA\u53C3\u6578");
    if (params.pdf && isValidPdfHref(params.pdf)) return { url: params.pdf, detail: null, params };
    const detail = await fetchOwnerDetail(params);
    const pdf = detail.PDF || "";
    if (!isValidPdfHref(pdf)) throw new Error("API \u56DE\u50B3\u6C92\u6709 PDF");
    return { url: pdf, detail, params };
  }

  // src/route-scanner.js
  var ROUTE_SELECT_SELECTOR = "select#selBARoad";
  var TABLE_SELECTOR = "table#BuAddr";
  var TABLE_CONTAINER_SELECTOR = "#CommunityCase";
  function abortError() {
    return new DOMException("\u6383\u63CF\u5DF2\u53D6\u6D88", "AbortError");
  }
  function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
  }
  function getRouteSelect() {
    return document.querySelector(ROUTE_SELECT_SELECTOR);
  }
  function isPlaceholderOption(option) {
    const value = String(option?.value || "").trim();
    const text = String(option?.textContent || "").replace(/\s+/g, " ").trim();
    if (!value || !text) return true;
    if (option.disabled || option.hidden || option.dataset?.placeholder === "true") return true;
    return /^(請選擇|請選|選擇)?\s*(路段|分頁)\s*$/.test(text);
  }
  function getValidRouteOptions(select = getRouteSelect()) {
    if (!select) return [];
    const seenValues = /* @__PURE__ */ new Set();
    return Array.from(select.options).filter((option) => !isPlaceholderOption(option)).map((option) => ({
      value: String(option.value),
      label: String(option.textContent || "").replace(/\s+/g, " ").trim()
    })).filter((option) => {
      if (seenValues.has(option.value)) return false;
      seenValues.add(option.value);
      return true;
    });
  }
  function getTableSignature() {
    const container = document.querySelector(TABLE_CONTAINER_SELECTOR);
    const table = document.querySelector(TABLE_SELECTOR);
    if (!container || !table) return "";
    const headers = Array.from(table.querySelectorAll("th")).map((cell) => (cell.childNodes[0]?.textContent || cell.textContent || "").replace(/\s+/g, " ").trim()).join("|");
    const households = Array.from(container.querySelectorAll("td")).map((cell) => {
      const owners = Array.from(cell.querySelectorAll("[onclick*='checkAndShowCommunityOwnerAddr']")).map((link) => link.getAttribute("onclick") || "").join(",");
      const area = cell.querySelector(".ETRPin")?.textContent?.trim() || "";
      return `${cell.className}:${area}:${owners}`;
    }).join("|");
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
  function waitForTableRefresh({
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
          finish(new Error(`\u7B49\u5F85\u8DEF\u6BB5\u8868\u683C\u66F4\u65B0\u903E\u6642\uFF08${Math.round((Date.now() - startedAt) / 1e3)} \u79D2\uFF09`));
        }, timeout);
        signal?.addEventListener("abort", onAbort, { once: true });
        check();
      } catch (error) {
        finish(error);
      }
    });
  }
  async function switchRouteAndWait(route, timeout = CONFIG.ROUTE_REFRESH_TIMEOUT_MS, signal, { forceRefresh = false } = {}) {
    throwIfAborted(signal);
    const select = getRouteSelect();
    if (!select) throw new Error(`\u627E\u4E0D\u5230\u8DEF\u6BB5\u9078\u55AE\uFF1A${ROUTE_SELECT_SELECTOR}`);
    if (!Array.from(select.options).some((option) => option.value === route.value && !option.disabled)) {
      throw new Error(`\u8DEF\u6BB5\u9078\u9805\u5DF2\u4E0D\u5B58\u5728\uFF1A${route.label}`);
    }
    if (select.value === route.value && !forceRefresh) return true;
    const previousTable = document.querySelector(TABLE_SELECTOR);
    const previousSignature = getTableSignature();
    select.value = route.value;
    if (select.value !== route.value) throw new Error(`\u7121\u6CD5\u5207\u63DB\u5230\u8DEF\u6BB5\uFF1A${route.label}`);
    const refreshPromise = waitForTableRefresh({ targetValue: route.value, previousTable, previousSignature, timeout, signal });
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await refreshPromise;
    throwIfAborted(signal);
    const currentSelect = getRouteSelect();
    if (!currentSelect || currentSelect.value !== route.value) throw new Error(`\u8DEF\u6BB5\u5207\u63DB\u5F8C value \u4E0D\u7B26\uFF1A${route.label}`);
    return true;
  }
  async function restoreOriginalRoute(originalValue, timeout = CONFIG.ROUTE_REFRESH_TIMEOUT_MS) {
    if (originalValue == null) return;
    const select = getRouteSelect();
    if (!select || !Array.from(select.options).some((option2) => option2.value === originalValue)) return;
    const option = Array.from(select.options).find((item) => item.value === originalValue);
    await switchRouteAndWait({ value: originalValue, label: option?.textContent?.trim() || originalValue }, timeout);
    await sleep(0);
  }
  async function scanAllRoutePages({
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
    const effectiveRoutes = routes.length ? routes : [{ value: originalValue || "", label: "\u76EE\u524D\u756B\u9762", currentOnly: true }];
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
          const failure = { route: route.label, value: route.value, reason: error?.message || "\u8DEF\u6BB5\u6383\u63CF\u5931\u6557" };
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
        log("\u8DEF\u6BB5\u6062\u5FA9\u524D\u6E05\u7406\u5931\u6557", error);
        onRestoreError?.(error);
      }
      try {
        if (initialSelect && originalValue != null) await restoreOriginalRoute(originalValue, routeTimeout);
      } catch (error) {
        log("\u6062\u5FA9\u539F\u59CB\u8DEF\u6BB5\u5931\u6557", error);
        onRestoreError?.(error);
      }
      try {
        await onRestored?.();
      } catch (error) {
        log("\u8DEF\u6BB5\u6062\u5FA9\u5F8C\u91CD\u65B0\u6383\u63CF\u5931\u6557", error);
        onRestoreError?.(error);
      }
    }
  }

  // src/export.js
  function downloadBlob(content, mimeType, filename) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      anchor.remove();
    }, 0);
  }
  function downloadJson(data, filename = `ycut_${Date.now()}.json`) {
    downloadBlob(JSON.stringify(data, null, 2), "application/json;charset=utf-8", filename);
  }
  function normalizePdfUrls(pdfUrls) {
    const seen = /* @__PURE__ */ new Set();
    const normalized = [];
    for (const value of pdfUrls || []) {
      const url = typeof value === "string" ? value.trim() : "";
      if (!url || !isValidPdfHref(url) || seen.has(url)) continue;
      seen.add(url);
      normalized.push(url);
    }
    return normalized;
  }
  function safeName(value) {
    return String(value || "community").replace(/[\\/:*?"<>|\r\n]/g, "_").replace(/\s+/g, "_").slice(0, 80) || "community";
  }
  function getCommunityName() {
    const breadcrumb = document.querySelector('.breadcrumb, [class*="breadcrumb"], [class*="crumb"]');
    if (breadcrumb) {
      const parts = (breadcrumb.innerText || breadcrumb.textContent || "").split(/[\/\n>]/).map((part) => part.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
    return (document.title || "community").replace(/[^\p{L}\p{N}_-]/gu, "") || "community";
  }
  function createPdfExportBaseFilename(communityName = "community") {
    const now = /* @__PURE__ */ new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `ycut_pdf_database_${safeName(communityName)}_${stamp}`;
  }
  function exportPdfUrlJson(pdfUrls, filename) {
    const normalized = normalizePdfUrls(pdfUrls);
    downloadJson(normalized, filename.endsWith(".json") ? filename : `${filename}.json`);
    return normalized;
  }
  function csvCell(value) {
    return `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
  }
  function buildFailuresCsv(failures) {
    const headers = ["\u8DEF\u6BB5", "\u9580\u724C", "Etr_idx", "Owner_idx", "\u91CD\u8A66\u6B21\u6578", "\u5931\u6557\u539F\u56E0"];
    const rows = failures.map((failure) => [
      failure.route,
      failure.door ?? failure.doorplate ?? failure.household ?? failure.text,
      failure.etr_idx ?? failure.etrIdx,
      failure.owner_idx ?? failure.ownerIdx,
      failure.attempts,
      failure.reason
    ]);
    return `\uFEFF${headers.map(csvCell).join(",")}\r
${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  }
  function exportFailuresCsv(failures, filename) {
    if (!Array.isArray(failures) || failures.length === 0) return false;
    const csv = buildFailuresCsv(failures);
    downloadBlob(csv, "text/csv;charset=utf-8", filename.endsWith(".csv") ? filename : `${filename}.csv`);
    return true;
  }
  function exportPdfResults(pdfUrls, failures, communityName = "community") {
    const baseFilename = createPdfExportBaseFilename(communityName);
    const normalizedUrls = exportPdfUrlJson(pdfUrls, `${baseFilename}.json`);
    if (failures.length > 0) {
      exportFailuresCsv(failures, `${baseFilename}_failures.csv`);
    }
    return { baseFilename, pdfUrls: normalizedUrls };
  }
  function exportFailureList(failures, communityName = "community") {
    if (!Array.isArray(failures) || failures.length === 0) return false;
    const baseFilename = createPdfExportBaseFilename(communityName);
    return exportFailuresCsv(failures, `${baseFilename}_failures.csv`);
  }

  // src/extractor.js
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
    const floor = row?.querySelector?.("th")?.textContent?.trim() || row?.children?.[0]?.textContent?.trim() || "";
    let doorplate = "";
    if (cell && table) {
      const colIndex = cell.cellIndex;
      const rows = Array.from(table.querySelectorAll("tr"));
      for (const headerRow of rows) {
        const headerCell = headerRow.children?.[colIndex];
        const text = headerCell?.textContent?.replace(/\s+/g, " ").trim();
        if (text && text.includes("\u865F")) {
          doorplate = text.replace(/^選\s*/, "");
          break;
        }
      }
    }
    const parts = [doorplate, floor].filter(Boolean);
    if (area != null) parts.push(`\u5EFA\u576A ${area}`);
    return parts.length ? parts.join(" / ") : (cell?.textContent || anchor?.textContent || "").replace(/\s+/g, " ").trim() || "\u672A\u547D\u540D\u6236\u5225";
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
    const ownerCall = anchor?.closest?.("td")?.querySelector?.("[onclick*='checkAndShowCommunityOwnerAddr']")?.getAttribute?.("onclick");
    if (ownerCall) return `owner-call:${ownerCall}`;
    return `fallback:${routeValue}:${describeAnchor(anchor)}`;
  }
  async function scanCurrentRoute({
    delayBetween = CONFIG.DELAY_BETWEEN_MS,
    collapseAfter = true,
    perItemTimeout = CONFIG.PER_ITEM_TIMEOUT_MS,
    retries = CONFIG.MAX_RETRIES_PER_ITEM,
    routeValue = "",
    seenHouseholds = /* @__PURE__ */ new Set(),
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
      title: "\u64F7\u53D6 PDF \u4E2D",
      stage: "\u6E96\u5099\u958B\u59CB"
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
        title: "\u64F7\u53D6 PDF \u4E2D",
        current,
        stage: "\u5B9A\u4F4D\u76EE\u524D\u6236\u5225"
      });
      followAnchor(a);
      await closeCurrentModalIfAny();
      updatePanelProgress(idx, total, {
        title: "\u64F7\u53D6 PDF \u4E2D",
        current,
        stage: "\u7B49\u5F85\u9801\u9762\u9592\u7F6E"
      });
      await waitForPageIdle(perItemTimeout);
      try {
        updatePanelProgress(idx, total, {
          title: "\u64F7\u53D6 PDF \u4E2D",
          current,
          stage: "\u5617\u8A66 API \u64F7\u53D6"
        });
        got = (await getPdfByApi(a)).url;
      } catch (e) {
        lastError = e?.message || "API \u64F7\u53D6\u5931\u6557";
      }
      for (let attempt = 0; attempt <= retries && !got; attempt++) {
        let modal = null;
        try {
          updatePanelProgress(idx, total, {
            title: "\u64F7\u53D6 PDF \u4E2D",
            current,
            stage: `\u958B\u555F\u5C0F\u4EBA\u9078\u55AE\uFF08\u7B2C ${attempt + 1} \u6B21\uFF09`
          });
          const previousHref = extractPdfHrefFromModal(visibleModal());
          const result = await clickFirstOwnerAndWaitModal(a);
          modal = result.modal || visibleModal();
          if (!result.opened) lastError = "\u7121\u6CD5\u958B\u555F\u5C0F\u4EBA\u9078\u55AE";
          updatePanelProgress(idx, total, {
            title: "\u64F7\u53D6 PDF \u4E2D",
            current,
            stage: "\u7B49\u5F85 PDF \u9023\u7D50"
          });
          const hrefReady = await waitForValidPdfHref(modal || null, perItemTimeout, previousHref);
          const fallbackHref = extractPdfHrefFromModal(modal || null);
          got = hrefReady || (fallbackHref && fallbackHref !== previousHref ? fallbackHref : null);
          updatePanelProgress(idx, total, {
            title: "\u64F7\u53D6 PDF \u4E2D",
            current,
            stage: "\u78BA\u8A8D\u9801\u9762\u72C0\u614B"
          });
          await waitForPageIdle(perItemTimeout);
          if (!got) {
            lastError = "\u627E\u4E0D\u5230 PDF \u9023\u7D50";
            await sleep(300);
          }
        } catch (e) {
          lastError = e?.message || "\u64F7\u53D6\u5931\u6557";
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
        failed.push({ index: idx + 1, text: current, reason: lastError || "\u672A\u77E5\u932F\u8AA4" });
      }
      updatePanelProgress(idx + 1, total, {
        title: "\u64F7\u53D6 PDF \u4E2D",
        current,
        stage: got && isValidPdfHref(got) ? "\u6B64\u6236\u5B8C\u6210" : "\u6B64\u6236\u5931\u6557"
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
  async function scanAllRoutes(options = {}) {
    if (anyExtractorRunning()) return;
    const exportButton = document.getElementById("ycut-export-json");
    const databaseButton = document.getElementById("ycut-build-database");
    const originalButtonDisabled = exportButton?.disabled || false;
    const originalDatabaseButtonDisabled = databaseButton?.disabled || false;
    const allUrls = [];
    const allItemFailures = [];
    const routeFailures = [];
    const seenHouseholds = /* @__PURE__ */ new Set();
    let successfulRoutes = 0;
    let routeCount = 0;
    let totalCandidates = 0;
    let completionText = "\u6383\u63CF\u672A\u5B8C\u6210";
    legacyExtractorState.running = true;
    STATE.acting = true;
    if (exportButton) {
      exportButton.disabled = true;
      exportButton.setAttribute("aria-busy", "true");
    }
    if (databaseButton) databaseButton.disabled = true;
    setPanelWorking(true, "\u6E96\u5099\u6383\u63CF\u6240\u6709\u8DEF\u6BB5\u5206\u9801");
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
          setPanelStatus(`\u6B63\u5728\u6383\u63CF\u8DEF\u6BB5\uFF1A${route.label}`);
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
          log("\u8DEF\u6BB5\u6383\u63CF\u5931\u6557\uFF0C\u7E7C\u7E8C\u4E0B\u4E00\u9801", failure);
        },
        onBeforeRestore: () => closeCurrentModalIfAny(),
        onRestored: () => scan()
      });
      routeCount = routeResult.routeCount;
      const uniqueUrls = normalizePdfUrls(allUrls);
      if (totalCandidates === 0) {
        completionText = "\u7BE9\u9078\u5F8C\u6C92\u6709\u7B26\u5408\u5EFA\u576A\u7684\u6236\u5225";
        alert("\u7BE9\u9078\u5F8C\u6C92\u6709\u7B26\u5408\u5EFA\u576A\u7684\u6236\u5225\uFF0C\u8ACB\u8ABF\u6574\u689D\u4EF6\u5F8C\u518D\u8A66\u3002");
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
          `\u6383\u63CF\u5206\u9801\uFF1A${routeCount}`,
          `\u6210\u529F\u5206\u9801\uFF1A${successfulRoutes}`,
          `\u5931\u6557\u5206\u9801\uFF1A${routeFailures.length}`,
          `\u627E\u5230 PDF\uFF1A${allUrls.length}`,
          `\u53BB\u91CD\u5F8C PDF\uFF1A${uniqueUrls.length}`
        ].join("\n");
      }
      if (allItemFailures.length) log("PDF \u64F7\u53D6\u5931\u6557\u6E05\u55AE", allItemFailures);
      if (routeFailures.length) log("\u8DEF\u6BB5\u5931\u6557\u6E05\u55AE", routeFailures);
      updatePanelProgress(routeCount, routeCount, {
        title: "\u64F7\u53D6\u5B8C\u6210",
        current: routeFailures.length ? `\u5931\u6557 ${routeFailures.length} \u500B\u5206\u9801` : "\u5168\u90E8\u5206\u9801\u5B8C\u6210",
        stage: `PDF ${allUrls.length}\uFF0C\u53BB\u91CD\u5F8C ${uniqueUrls.length}\uFF0C\u6236\u5225\u5931\u6557 ${allItemFailures.length}`
      });
      updateRouteProgress({
        routeName: "\u5168\u90E8\u5B8C\u6210",
        index: routeCount,
        total: routeCount,
        found: allUrls.length,
        failed: routeFailures.length
      });
    } catch (error) {
      completionText = `\u6383\u63CF\u4E2D\u6B62\uFF1A${error?.message || "\u672A\u77E5\u932F\u8AA4"}`;
      log("\u5168\u90E8\u8DEF\u6BB5\u6383\u63CF\u5931\u6557", error);
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

  // src/license.js
  var LICENSE_CACHE_TTL_MS = 30 * 60 * 1e3;
  var lastLicenseCheck = null;
  function taiwanDateString() {
    return new Date(Date.now() + 8 * 60 * 60 * 1e3).toISOString().slice(0, 10);
  }
  function isExpiredLicenseDate(expiresOn) {
    return !/^\d{4}-\d{2}-\d{2}$/.test(String(expiresOn || "")) || taiwanDateString() > expiresOn;
  }
  async function hasFreshLicenseCache(installId) {
    const stored = await chrome.storage.local.get([
      "license_status",
      "qr_licensed_install_id",
      "last_verified_at",
      "license_expires_on"
    ]);
    if (stored.license_status !== "valid" || stored.qr_licensed_install_id !== installId) {
      return false;
    }
    if (isExpiredLicenseDate(stored.license_expires_on)) {
      lastLicenseCheck = { reason: "expired", expires_on: stored.license_expires_on || null };
      await chrome.storage.local.set({ license_status: "invalid" });
      return false;
    }
    const verifiedAt = new Date(stored.last_verified_at || 0).getTime();
    return Number.isFinite(verifiedAt) && Date.now() - verifiedAt < LICENSE_CACHE_TTL_MS;
  }
  async function hasValidLicense() {
    try {
      const stored = await chrome.storage.local.get(["install_id"]);
      if (!stored.install_id) return false;
      if (await hasFreshLicenseCache(stored.install_id)) {
        return true;
      }
      const statusUrl = `${LICENSE_STATUS_API}?product_id=${encodeURIComponent(PRODUCT_ID)}&install_id=${encodeURIComponent(stored.install_id)}`;
      const res = await fetch(statusUrl);
      const result = await res.json();
      if (result && result.success && result.active) {
        lastLicenseCheck = result;
        await chrome.storage.local.set({
          license_status: "valid",
          qr_licensed_install_id: stored.install_id,
          last_verified_at: (/* @__PURE__ */ new Date()).toISOString(),
          license_expires_on: result.expires_on
        });
        return true;
      }
      lastLicenseCheck = result;
      await chrome.storage.local.set({
        license_status: "invalid",
        license_expires_on: result?.expires_on || null
      });
      return false;
    } catch {
      const stored = await chrome.storage.local.get(["install_id"]);
      return !!stored.install_id && await hasFreshLicenseCache(stored.install_id);
    }
  }
  async function requireLicenseForPremiumAction() {
    const ok = await hasValidLicense();
    if (ok) return true;
    if (lastLicenseCheck?.reason === "expired") {
      const expiresOn = lastLicenseCheck.expires_on || "\u8A2D\u5B9A\u671F\u9650";
      alert(`\u6388\u6B0A\u5DF2\u65BC ${expiresOn} \u5230\u671F\u3002

\u8ACB\u6253\u958B\u64F4\u5145\u5DE5\u5177 popup\uFF0C\u91CD\u65B0\u7522\u751F QR Code \u4E26\u8ACB\u7BA1\u7406\u54E1\u6838\u51C6\u3002`);
      setPanelStatus(`\u6388\u6B0A\u5DF2\u65BC ${expiresOn} \u5230\u671F\uFF0CPDF / JSON \u4E0B\u8F09\u5DF2\u9396\u5B9A`);
      return false;
    }
    alert("\u6B64\u529F\u80FD\u9700\u8981 QR \u6388\u6B0A\u5F8C\u624D\u80FD\u4F7F\u7528\u3002\n\n\u8ACB\u6253\u958B\u64F4\u5145\u5DE5\u5177 popup\uFF0C\u7522\u751F QR Code \u4E26\u8ACB\u7BA1\u7406\u54E1\u6838\u51C6\u3002");
    setPanelStatus("\u5C1A\u672A QR \u6388\u6B0A\uFF0CPDF / JSON \u4E0B\u8F09\u5DF2\u9396\u5B9A");
    return false;
  }

  // src/owner-api.js
  function makeAbortError() {
    return new DOMException("\u8CC7\u6599\u5EAB\u6383\u63CF\u5DF2\u53D6\u6D88", "AbortError");
  }
  function parseTranscriptDate(value) {
    const text = String(value || "").trim();
    const match = text.replace(/[年月.-]/g, "/").replace(/日/g, "").match(/(?:^|\D)(\d{2,4})\/(\d{1,2})\/(\d{1,2})(?:\D|$)/);
    if (!match) return null;
    let year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (match[1].length < 4) year += 1911;
    if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const time = Date.UTC(year, month - 1, day);
    const date = new Date(time);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return time;
  }
  function parseOwnerLinkParams(link) {
    const onclick = link?.getAttribute?.("onclick") || "";
    const match = onclick.match(/checkAndShowCommunityOwnerAddr\((.*)\)/);
    if (!match) return null;
    try {
      const values = JSON.parse(`[${match[1].replace(/'/g, '"')}]`);
      const etrIdx = String(values[1] || "");
      const ownerIdx = String(values[2] || "");
      if (!etrIdx || !ownerIdx) return null;
      return {
        pdf: values[0] || "",
        etrIdx,
        ownerIdx,
        checkViewLog: values[3] === true,
        city: values[4] || "",
        district: values[5] || "",
        sessionId: values[6] || "",
        etrNo: values[7] || "",
        label: (link.textContent || "").replace(/\s+/g, " ").trim(),
        displayedDateValue: parseTranscriptDate(link.textContent)
      };
    } catch {
      return null;
    }
  }
  function selectLatestOwnerParams(paramsList) {
    const valid = paramsList.filter((item) => item?.etrIdx && item?.ownerIdx);
    if (!valid.length) return null;
    const dated = valid.filter((item) => Number.isFinite(item.displayedDateValue));
    if (!dated.length) return { params: valid[0], usedDateFallback: true };
    const params = dated.reduce((latest, item) => item.displayedDateValue > latest.displayedDateValue ? item : latest);
    return { params, usedDateFallback: false };
  }
  function waitWithSignal(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(makeAbortError());
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(makeAbortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  async function requestOwnerDetails(params, {
    signal,
    timeoutMs = CONFIG.OWNER_API_TIMEOUT_MS
  } = {}) {
    if (signal?.aborted) throw makeAbortError();
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetch(COMM_GATEWAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          Method: "GetOwnerDetail",
          Data: { Etr_idx: params.etrIdx, Owner_idx: params.ownerIdx }
        })
      });
      if (!response.ok) throw new Error(`CommGateway HTTP ${response.status}`);
      const result = await response.json();
      if (String(result?.Status) !== "1") throw new Error(result?.Message || `CommGateway status ${result?.Status ?? "unknown"}`);
      const details = Array.isArray(result.Data) ? result.Data.filter((item) => item && typeof item === "object") : [];
      if (!details.length) throw new Error("API \u56DE\u50B3\u7A7A\u8CC7\u6599");
      return { result, details };
    } catch (error) {
      if (signal?.aborted) throw makeAbortError();
      if (timedOut) throw new Error(`GetOwnerDetail timeout\uFF08${timeoutMs}ms\uFF09`);
      throw error;
    } finally {
      clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  async function requestOwnerDetailsWithRetry(params, {
    signal,
    timeoutMs = CONFIG.OWNER_API_TIMEOUT_MS,
    retryDelays = CONFIG.OWNER_API_RETRY_DELAYS_MS,
    onRetry
  } = {}) {
    const maxAttempts = retryDelays.length + 1;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await requestOwnerDetails(params, { signal, timeoutMs });
        return { ...response, attempts: attempt, retries: attempt - 1 };
      } catch (error) {
        if (error?.name === "AbortError" || signal?.aborted) throw error;
        lastError = error;
        if (attempt >= maxAttempts) break;
        const delayMs = retryDelays[attempt - 1];
        onRetry?.({ attempt, nextAttempt: attempt + 1, delayMs, error });
        await waitWithSignal(delayMs, signal);
      }
    }
    lastError.attempts = maxAttempts;
    throw lastError;
  }
  function detailDate(detail) {
    return detail?.RegPrintDate ?? detail?.TranscriptDate ?? detail?.PrintDate ?? detail?.EtrDate ?? detail?.RegDate ?? "";
  }
  function selectLatestDetail(details) {
    const valid = details.filter((item) => item && typeof item === "object" && [
      item.BuildAddr,
      item.Address,
      item.Owner,
      item.PDF,
      detailDate(item),
      item.BuiMPin,
      item.BuiAuxPin,
      item.BuiTotPin
    ].some((value) => value != null && String(value).trim() !== ""));
    if (!valid.length) return null;
    const dated = valid.map((detail, sourceIndex) => ({ detail, sourceIndex, dateValue: parseTranscriptDate(detailDate(detail)) })).filter((item) => Number.isFinite(item.dateValue));
    if (!dated.length) {
      return { detail: valid[0], sourceIndex: 0, usedDateFallback: true, parsedDateValue: null };
    }
    const newest = dated.reduce((latest, item) => item.dateValue > latest.dateValue ? item : latest);
    return {
      detail: newest.detail,
      sourceIndex: newest.sourceIndex,
      usedDateFallback: false,
      parsedDateValue: newest.dateValue
    };
  }
  function postalCode(detail, address) {
    const explicit = detail?.ZipCode ?? detail?.ZIP ?? detail?.Zip ?? detail?.PostalCode ?? detail?.PostCode ?? detail?.BuildZipCode;
    if (explicit != null && String(explicit).trim()) return String(explicit).trim();
    return String(address || "").match(/^\s*(\d{3,6})\b/)?.[1] || "";
  }
  function normalizeDatabaseRecord(unit, selectedDetail, { attempts = 1 } = {}) {
    const detail = selectedDetail.detail;
    const address = detail.BuildAddr || detail.Address || "";
    const pdfUrl = detail.PDF || "";
    const usedDateFallback = !!unit.usedDateFallback || !!selectedDetail.usedDateFallback;
    const hasValidPdf = isValidPdfHref(pdfUrl);
    const queryResult = !hasValidPdf ? usedDateFallback ? "\u6210\u529F\uFF08\u65E5\u671F fallback\u3001\u7121\u6709\u6548 PDF\uFF09" : "\u6210\u529F\uFF08\u7121\u6709\u6548 PDF\uFF09" : usedDateFallback ? "\u6210\u529F\uFF08\u65E5\u671F fallback\uFF09" : "\u6210\u529F\uFF08\u6700\u65B0\u65E5\u671F\uFF09";
    return {
      \u8DEF\u6BB5: unit.routeLabel,
      \u9580\u724C: unit.householdLabel,
      \u6240\u6709\u6B0A\u4EBA: detail.Owner || "",
      \u90F5\u905E\u5340\u865F: postalCode(detail, address),
      \u5B8C\u6574\u5730\u5740: address,
      \u4E3B\u5EFA\u576A: detail.BuiMPin ?? "",
      \u9644\u5C6C\u576A: detail.BuiAuxPin ?? "",
      \u7E3D\u576A: detail.BuiTotPin ?? "",
      \u8B04\u672C\u65E5\u671F: detailDate(detail),
      "PDF URL": pdfUrl,
      Etr_idx: unit.params.etrIdx,
      Owner_idx: unit.params.ownerIdx,
      \u67E5\u8A62\u7D50\u679C: queryResult,
      \u65E5\u671Ffallback: usedDateFallback,
      API\u5617\u8A66\u6B21\u6578: attempts
    };
  }
  function databaseRecordKey(record) {
    return `${record.Etr_idx}|${record.Owner_idx}|${record["PDF URL"] || ""}`;
  }

  // src/database-scanner.js
  function doorplateForCell(cell) {
    const tables = [cell.closest("table"), document.querySelector("table#BuAddr")].filter((table, index, items) => table && items.indexOf(table) === index);
    for (const table of tables) {
      for (const row of Array.from(table.rows || [])) {
        const header = row.cells?.[cell.cellIndex];
        if (!header || header === cell) continue;
        const text = (header.childNodes?.[0]?.textContent || header.textContent || "").replace(/^選\s*/, "").replace(/\s+/g, " ").trim();
        if (text.includes("\u865F")) return text;
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
      const householdLabel = [doorplate, floor].filter(Boolean).join(" ") || (cell.textContent || "").replace(/\s+/g, " ").trim() || `${route.label} \u6236\u5225`;
      const householdKey = candidates.map((item) => `${item.etrIdx}:${item.ownerIdx}`).sort().join("|");
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
    return Array.from(document.querySelectorAll("#CommunityCase td")).filter((cell) => cell.querySelector("ul.dropdown-menu li a[onclick*='checkAndShowCommunityOwnerAddr']"));
  }
  function getHouseholdListFingerprint() {
    const container = document.querySelector("#CommunityCase");
    if (!container) return "";
    return Array.from(container.querySelectorAll(
      "ul.dropdown-menu li a[onclick*='checkAndShowCommunityOwnerAddr']"
    )).map((link) => (link.getAttribute("onclick") || "").replace(/\s+/g, " ").trim()).filter(Boolean).sort().join("|");
  }
  async function waitForHouseholdListStable({
    previousFingerprint,
    requireChange,
    signal,
    timeout = 15e3,
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
    throw new Error("\u7B49\u5F85\u65B0\u6236\u5225\u6E05\u55AE\u8F09\u5165\u903E\u6642");
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
          Math.min(routeTimeout || CONFIG.ROUTE_REFRESH_TIMEOUT_MS, 1e4),
          signal,
          { forceRefresh: attempt > 1 }
        );
        const actualRouteValue = getRouteSelect()?.value ?? "";
        if (actualRouteValue !== route.value) {
          throw new Error(`\u8DEF\u6BB5\u5207\u63DB\u5931\u6557\uFF1A\u9810\u671F ${route.value}\uFF0C\u5BE6\u969B ${actualRouteValue}`);
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
    throw lastError || new Error(`\u8DEF\u6BB5\u8F09\u5165\u5931\u6557\uFF1A${route.label}`);
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
  function cancelDatabaseScan() {
    if (!databaseExtractorState.running) return;
    databaseExtractorState.cancelRequested = true;
    databaseExtractorState.abortController?.abort();
  }
  function exportLastDatabaseFailures() {
    exportFailureList(databaseExtractorState.lastFailures, databaseExtractorState.lastCommunityName);
  }
  async function buildPdfDatabase() {
    if (anyExtractorRunning()) return;
    const buttonStates = snapshotButtonStates();
    const controller = new AbortController();
    const signal = controller.signal;
    const community = getCommunityName();
    const units = [];
    const unitKeys = /* @__PURE__ */ new Set();
    const records = [];
    const recordKeys = /* @__PURE__ */ new Set();
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
    let completionText = "\u8CC7\u6599\u5EAB\u6383\u63CF\u672A\u5B8C\u6210";
    databaseExtractorState.running = true;
    databaseExtractorState.cancelRequested = false;
    databaseExtractorState.abortController = controller;
    databaseExtractorState.lastCommunityName = community;
    databaseExtractorState.lastFailures = [];
    STATE.acting = true;
    setDatabaseButtonsRunning(true);
    setProgressMode("database");
    setPanelWorking(true, "\u6B63\u5728\u6536\u96C6\u6240\u6709\u8DEF\u6BB5\u6236\u5225");
    databaseProgress(metrics, { phase: "\u6536\u96C6\u6236\u5225" });
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
          databaseProgress(metrics, { phase: "\u5207\u63DB\u8DEF\u6BB5" });
        },
        onRoute: async ({ route, routeNumber, totalRoutes }) => {
          throwIfAborted(signal);
          const selectedRouteValue = getRouteSelect()?.value ?? "";
          if (!route.currentOnly && selectedRouteValue !== route.value) {
            throw new Error(`\u8DEF\u6BB5\u5207\u63DB\u5931\u6557\uFF1A\u9810\u671F ${route.value}\uFF0C\u5BE6\u969B ${selectedRouteValue}`);
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
          databaseProgress(metrics, { phase: "\u6536\u96C6\u6236\u5225" });
          return { householdCount: currentUnits.length };
        },
        onRouteError: ({ error, failure }) => {
          const failureItem = {
            stage: "route",
            route: failure.route,
            routeValue: failure.value,
            reason: failure.reason,
            attempts: error?.routeAttempts || 0,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          };
          failures.push(failureItem);
          databaseProgress(metrics, { phase: "\u8DEF\u6BB5\u5931\u6557" });
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
        databaseProgress(metrics, { phase: `\u67E5\u8A62\u6236\u5225\uFF1A${unit.householdLabel}` });
        let apiAttempts = 0;
        try {
          const response = await requestOwnerDetailsWithRetry(unit.params, {
            signal,
            onRetry: () => {
              metrics.apiRetries++;
              databaseProgress(metrics, { phase: `API \u91CD\u8A66\uFF1A${unit.householdLabel}` });
            }
          });
          apiAttempts = response.attempts;
          const selectedDetail = selectLatestDetail(response.details);
          if (!selectedDetail) throw new Error("API \u6C92\u6709\u53EF\u7528\u7684\u8B04\u672C\u8CC7\u6599");
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
                reason: "GetOwnerDetail \u56DE\u50B3\u6C92\u6709\u6709\u6548 PDF URL",
                timestamp: (/* @__PURE__ */ new Date()).toISOString()
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
            reason: error?.message || "GetOwnerDetail \u5931\u6557",
            usedDateFallback: unit.usedDateFallback,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
        metrics.processedHouseholds = index + 1;
        databaseProgress(metrics, { phase: "\u67E5\u8A62 API" });
        if (index + 1 < units.length) await waitWithSignal(CONFIG.DATABASE_API_GAP_MS, signal);
      }
      databaseExtractorState.lastFailures = failures;
      const validUrlsBeforeExport = records.map((record) => record["PDF URL"]).filter(isValidPdfHref);
      const exported = exportPdfResults(validUrlsBeforeExport, failures, community);
      metrics.duplicateSkipped += validUrlsBeforeExport.length - exported.pdfUrls.length;
      metrics.validPdf = exported.pdfUrls.length;
      completionText = [
        `\u6383\u63CF\u8DEF\u6BB5\uFF1A${metrics.totalRoutes}`,
        `\u6210\u529F\u8DEF\u6BB5\uFF1A${metrics.successfulRoutes}`,
        `\u6236\u5225\u7E3D\u6578\uFF1A${metrics.totalHouseholds}`,
        `API\u6210\u529F\uFF1A${metrics.apiSuccess}`,
        `API\u5931\u6557\uFF1A${metrics.apiFailed}`,
        `\u6709\u6548PDF\uFF1A${metrics.validPdf}`,
        `\u91CD\u8907\u7565\u904E\uFF1A${metrics.duplicateSkipped}`
      ].join("\n");
      databaseProgress(metrics, { phase: "\u8CC7\u6599\u5EAB\u5EFA\u7ACB\u5B8C\u6210" });
    } catch (error) {
      databaseExtractorState.lastFailures = failures;
      if (error?.name === "AbortError" || signal.aborted) {
        completionText = `\u8CC7\u6599\u5EAB\u6383\u63CF\u5DF2\u53D6\u6D88
\u5DF2\u8655\u7406\u6236\u5225\uFF1A${metrics.processedHouseholds} / ${metrics.totalHouseholds}`;
        databaseProgress(metrics, { phase: "\u5DF2\u53D6\u6D88" });
      } else {
        completionText = `\u8CC7\u6599\u5EAB\u6383\u63CF\u4E2D\u6B62\uFF1A${error?.message || "\u672A\u77E5\u932F\u8AA4"}`;
        log("PDF \u8CC7\u6599\u5EAB\u6383\u63CF\u4E2D\u6B62", error);
        databaseProgress(metrics, { phase: "\u6383\u63CF\u4E2D\u6B62" });
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

  // src/disclaimer.js
  var DISCLAIMER_VERSION = 1;
  var DISCLAIMER_STORAGE_KEY = `ycut_disclaimer_accepted_v${DISCLAIMER_VERSION}`;
  async function getDisclaimerAccepted() {
    try {
      const stored = await chrome.storage.local.get([DISCLAIMER_STORAGE_KEY]);
      const record = stored?.[DISCLAIMER_STORAGE_KEY];
      return record?.accepted === true && record?.version === DISCLAIMER_VERSION;
    } catch {
      return false;
    }
  }

  // src/content.js
  var ycutInitialized = false;
  var bootstrapPromise = null;
  var authorizationRetryRequested = false;
  function bindHotkeys() {
    document.addEventListener("keydown", (e) => {
      if (e.altKey && e.shiftKey && e.code === "KeyU") {
        e.preventDefault();
        mountPanelWithHandlers();
        applyHighlight(!STATE.highlighted);
      }
    });
  }
  var scanDebounce = null;
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
      onScan: () => {
        scan();
        setPanelStatus("\u5DF2\u91CD\u65B0\u6383\u63CF");
      },
      onHighlight: () => applyHighlight(!STATE.highlighted),
      onDoorplateToggle: (enabled) => injectDoorplateCheckboxes(enabled),
      onDoorplateAll: () => setAllDoorplateCheckboxes(true),
      onDoorplateNone: () => setAllDoorplateCheckboxes(false),
      onExport: async () => {
        if (!await requireLicenseForPremiumAction()) return;
        setProgressMode("legacy");
        await scanAllRoutes({
          delayBetween: CONFIG.DELAY_BETWEEN_MS,
          collapseAfter: true,
          perItemTimeout: CONFIG.PER_ITEM_TIMEOUT_MS,
          retries: CONFIG.MAX_RETRIES_PER_ITEM
        });
      },
      onBuildDatabase: async () => {
        if (!await requireLicenseForPremiumAction()) return;
        await buildPdfDatabase();
      },
      onCancelDatabase: () => cancelDatabaseScan(),
      onExportFailures: () => exportLastDatabaseFailures()
    });
  }
  function bindRuntimeMessages() {
    chrome.runtime?.onMessage?.addListener?.((m) => {
      if (!m?.type) return;
      if (m.type === "YCUT_SCAN") {
        scan();
        return true;
      }
      if (m.type === "YCUT_TOGGLE_HIGHLIGHT") {
        applyHighlight(!STATE.highlighted);
        return true;
      }
    });
  }
  async function initializeYCutExtractor() {
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
  async function bootstrapYCutExtractor() {
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
    const disclaimerWasAccepted = disclaimerRecord?.accepted === true && disclaimerRecord?.version === DISCLAIMER_VERSION;
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
      bootstrapYCutExtractor().catch(() => {
      });
      sendResponse?.({ ok: true });
    }
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => bootstrapYCutExtractor(), { once: true });
  } else {
    bootstrapYCutExtractor();
  }
})();
