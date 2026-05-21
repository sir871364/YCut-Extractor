chrome.runtime.sendMessage({type:'YCUT_AUTOCONFIRM'});
(() => {
  // src/state.js
  var STATE = {
    nodes: /* @__PURE__ */ new Set(),
    highlighted: false,
    observer: null,
    acting: false,
    autoFollow: true,
    doorplateSelectEnabled: false,
    selectedColIdx: /* @__PURE__ */ new Set(),
    colIdxToDoorplate: /* @__PURE__ */ new Map()
  };

  // src/config.js
  var SEL = {
    anchor: "a",
    iconUser: "i.icon.icon-user",
    dropdown: "ul.dropdown-menu"
  };
  var CONFIG = {
    DELAY_BETWEEN_MS: 2e3,
    PER_ITEM_TIMEOUT_MS: 3e4,
    MAX_RETRIES_PER_ITEM: 2
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
  function setPanelWorking(working, text) {
    STATE.acting = working;
    const el = document.getElementById("ycut-progress");
    if (el) el.textContent = text || (working ? "\u57F7\u884C\u4E2D\u2026" : "\u5F85\u547D");
  }
  function updatePanelProgress(done, total) {
    const el = document.getElementById("ycut-progress");
    if (el) el.textContent = `\u9032\u5EA6\uFF1A${done}/${total}`;
  }
  function mountPanel({
    onScan,
    onHighlight,
    onAutoFollow,
    onDoorplateToggle,
    onDoorplateAll,
    onDoorplateNone,
    onExport
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
      <button id="ycut-close">\u95DC\u9589\u9762\u677F</button>
    </div>
    <div id="ycut-progress" class="muted">\u5F85\u547D</div>
    <div style="font-size:12px;opacity:.75;margin-top:6px;">\u5FEB\u6377\u9375\uFF1AAlt+Shift+U \u9AD8\u4EAE</div>
  `;
    document.body.appendChild(panel);
    panel.querySelector("#ycut-scan").addEventListener("click", onScan);
    panel.querySelector("#ycut-highlight").addEventListener("click", onHighlight);
    panel.querySelector("#ycut-auto-follow").addEventListener("click", () => {
      STATE.autoFollow = !STATE.autoFollow;
      panel.querySelector("#ycut-auto-follow").textContent = `\u81EA\u52D5\u8DDF\u96A8\uFF1A${STATE.autoFollow ? "\u958B" : "\u95DC"}`;
      onAutoFollow?.(STATE.autoFollow);
    });
    panel.querySelector("#ycut-export-json").addEventListener("click", onExport);
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

  // src/extractor.js
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
  async function exportPdfLinksAsJson({
    delayBetween = CONFIG.DELAY_BETWEEN_MS,
    collapseAfter = true,
    perItemTimeout = CONFIG.PER_ITEM_TIMEOUT_MS,
    retries = CONFIG.MAX_RETRIES_PER_ITEM
  } = {}) {
    if (STATE.acting) return;
    const candidates = buildCandidates();
    if (!candidates.length) {
      setPanelStatus("\u7BE9\u9078\u5F8C\u6C92\u6709\u7B26\u5408\u5EFA\u576A\u7684\u6236\u5225");
      alert("\u7BE9\u9078\u5F8C\u6C92\u6709\u4EFB\u4F55\u7B26\u5408\u5EFA\u576A\u5340\u9593\u7684\u6236\u5225\u3002");
      return;
    }
    STATE.acting = true;
    const total = candidates.length;
    setPanelWorking(true, `\u64F7\u53D6 PDF \u4E2D\u2026\uFF08\u7BE9\u9078\u5F8C ${total} \u6236\uFF09`);
    const urls = [];
    const failed = [];
    for (let idx = 0; idx < total; idx++) {
      const a = candidates[idx];
      updatePanelProgress(idx, total);
      followAnchor(a);
      await closeCurrentModalIfAny();
      await waitForPageIdle(perItemTimeout);
      let got = null;
      let lastError = "";
      try {
        got = (await getPdfByApi(a)).url;
      } catch (e) {
        lastError = e?.message || "API \u64F7\u53D6\u5931\u6557";
      }
      for (let attempt = 0; attempt <= retries && !got; attempt++) {
        let modal = null;
        try {
          const previousHref = extractPdfHrefFromModal(visibleModal());
          const result = await clickFirstOwnerAndWaitModal(a);
          modal = result.modal || visibleModal();
          if (!result.opened) lastError = "\u672A\u958B\u555F\u660E\u7D30";
          const hrefReady = await waitForValidPdfHref(modal || null, perItemTimeout, previousHref);
          const fallbackHref = extractPdfHrefFromModal(modal || null);
          got = hrefReady || (fallbackHref && fallbackHref !== previousHref ? fallbackHref : null);
          await waitForPageIdle(perItemTimeout);
          if (!got) {
            lastError = "\u627E\u4E0D\u5230 PDF \u9023\u7D50";
            await sleep(300);
          }
        } catch (e) {
          lastError = e?.message || "\u64F7\u53D6\u4F8B\u5916";
          await sleep(300);
        } finally {
          if (collapseAfter) await closeAfterExtraction(a, modal);
        }
      }
      if (got && isValidPdfHref(got)) urls.push(got);
      else failed.push({ index: idx + 1, text: (a.textContent || "").trim(), reason: lastError || "\u672A\u77E5\u539F\u56E0" });
      updatePanelProgress(idx + 1, total);
      await sleep(delayBetween);
    }
    const uniq = Array.from(new Set(urls));
    downloadJson(uniq, `ycut_pdf_${Date.now()}.json`);
    if (failed.length) log("PDF \u64F7\u53D6\u5931\u6557\u9805\u76EE", failed);
    setPanelWorking(false, `\u5DF2\u64F7\u53D6 ${urls.length}/${total}\uFF0C\u4E0D\u91CD\u8907 ${uniq.length}\uFF0C\u5931\u6557 ${failed.length}`);
  }

  // src/license.js
  async function hasValidLicense() {
    try {
      const stored = await chrome.storage.local.get(["install_id", "license_status", "qr_licensed_install_id"]);
      if (!stored.install_id) return false;
      const statusUrl = `${LICENSE_STATUS_API}?product_id=${encodeURIComponent(PRODUCT_ID)}&install_id=${encodeURIComponent(stored.install_id)}`;
      const res = await fetch(statusUrl);
      const result = await res.json();
      if (result && result.success && result.active) {
        await chrome.storage.local.set({
          license_status: "valid",
          qr_licensed_install_id: stored.install_id,
          last_verified_at: (/* @__PURE__ */ new Date()).toISOString()
        });
        return true;
      }
      await chrome.storage.local.set({ license_status: "invalid" });
      return false;
    } catch {
      const stored = await chrome.storage.local.get(["install_id", "license_status", "qr_licensed_install_id"]);
      return stored.license_status === "valid" && stored.qr_licensed_install_id === stored.install_id;
    }
  }
  async function requireLicenseForPremiumAction() {
    const ok = await hasValidLicense();
    if (ok) return true;
    alert("\u6B64\u529F\u80FD\u9700\u8981 QR \u6388\u6B0A\u5F8C\u624D\u80FD\u4F7F\u7528\u3002\n\n\u8ACB\u6253\u958B\u64F4\u5145\u5DE5\u5177 popup\uFF0C\u7522\u751F QR Code \u4E26\u8ACB\u7BA1\u7406\u54E1\u6838\u51C6\u3002");
    setPanelStatus("\u5C1A\u672A QR \u6388\u6B0A\uFF0CPDF / JSON \u4E0B\u8F09\u5DF2\u9396\u5B9A");
    return false;
  }

  // src/content.js
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
    if (m.type === "YCUT_SCAN") {
      scan();
      return true;
    }
    if (m.type === "YCUT_TOGGLE_HIGHLIGHT") {
      applyHighlight(!STATE.highlighted);
      return true;
    }
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
})();
