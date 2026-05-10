chrome.runtime.sendMessage({ type: "YCUT_AUTOCONFIRM" });

(() => {
  const STATE = {
    nodes: new Set(),
    highlighted: false,
    observer: null,
    acting: false,
    doorplateSelectEnabled: false,
    selectedColIdx: new Set(),
    colIdxToDoorplate: new Map()
  };

  const SEL = { anchor: "a", iconUser: "i.icon.icon-user", dropdown: "ul.dropdown-menu" };

  const CONFIG = {
    DELAY_BETWEEN_MS: 2000,
    PER_ITEM_TIMEOUT_MS: 30000,
    MAX_RETRIES_PER_ITEM: 2
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log("[YCUT]", ...a);

  const LICENSE_API = "https://ycut-license-api.sir8713642.workers.dev/verify-license";

  function isValidLicenseKey(value) {
    return /^[A-Z2-9]{5}(-[A-Z2-9]{5}){4}$/.test(value || "");
  }

  async function hasValidLicense() {
    try {
      const stored = await chrome.storage.local.get(["license_key", "install_id", "license_status"]);
      if (!stored.license_key || !stored.install_id || !isValidLicenseKey(stored.license_key)) return false;

      const verifyUrl = `${LICENSE_API}?license_key=${encodeURIComponent(stored.license_key)}&install_id=${encodeURIComponent(stored.install_id)}`;
      const res = await fetch(verifyUrl);
      const result = await res.json();

      if (result && result.success) {
        await chrome.storage.local.set({
          license_status: "valid",
          last_verified_at: new Date().toISOString()
        });
        return true;
      }

      await chrome.storage.local.set({ license_status: "invalid" });
      return false;
    } catch (e) {
      const stored = await chrome.storage.local.get(["license_status"]);
      return stored.license_status === "valid";
    }
  }

  async function requireLicenseForPremiumAction() {
    const ok = await hasValidLicense();
    if (ok) return true;
    alert("此功能需要啟用授權後才能使用。\n\n未授權仍可使用：掃描、查看、高亮。\n授權後開放：PDF / JSON 擷取下載。");
    setPanelStatus("尚未授權，PDF / JSON 下載已鎖定");
    return false;
  }

  function isVisible(el) {
    if (!el) return false;
    const st = getComputedStyle(el);
    return el.offsetParent !== null && st.visibility !== "hidden" && st.display !== "none";
  }

  async function waitFor(fn, { timeout = 4000, interval = 80 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        const v = fn();
        if (v) return v;
      } catch {}
      await sleep(interval);
    }
    return null;
  }

  function getBuAddrTable() {
    return document.querySelector("table#BuAddr");
  }

  function buildDoorplateMap() {
    STATE.colIdxToDoorplate.clear();
    const table = getBuAddrTable();
    if (!table) return;
    const ths = Array.from(table.querySelectorAll("thead tr th"));
    ths.forEach((th, idx) => {
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
      label.style.position = "absolute";
      label.style.left = "6px";
      label.style.top = "2px";
      label.style.display = "flex";
      label.style.alignItems = "center";
      label.style.gap = "4px";
      label.style.fontSize = "12px";
      label.style.userSelect = "none";

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
      mini.textContent = "選";

      label.appendChild(cb);
      label.appendChild(mini);
      th.appendChild(label);
    });

    updateSelectedDoorplateText();
  }

  function setAllDoorplateCheckboxes(checked) {
    const table = getBuAddrTable();
    if (!table) return;
    const cbs = Array.from(table.querySelectorAll("input.ycut-doorplate-cb"));
    STATE.selectedColIdx.clear();
    cbs.forEach((cb) => {
      cb.checked = checked;
      const col = Number(cb.dataset.colIndex);
      if (checked) STATE.selectedColIdx.add(col);
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
      el.textContent = "（未啟用）";
      return;
    }
    if (STATE.selectedColIdx.size === 0) {
      el.textContent = "（未勾選＝全部門牌）";
      return;
    }
    const names = Array.from(STATE.selectedColIdx)
      .sort((a, b) => a - b)
      .map(getDoorplateByColIndex);
    el.textContent = names.join("、");
  }

  function pageIsBusy() {
    const candSel = [
      ".blockUI",
      ".ui-blockui",
      ".blockOverlay",
      ".blockMsg",
      ".loading",
      ".spinner",
      ".lds-spinner",
      ".modal:has(.loading)"
    ];
    for (const sel of candSel) {
      const el = document.querySelector(sel);
      if (el) {
        const st = getComputedStyle(el);
        if (st.display !== "none" && st.visibility !== "hidden" && el.offsetParent !== null) return true;
      }
    }
    const txt = (document.body.innerText || "").trim();
    if (txt.includes("資料讀取中")) return true;
    return false;
  }

  async function waitForPageIdle(timeout = 30000, interval = 120) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (!pageIsBusy()) return true;
      await sleep(interval);
    }
    return false;
  }

  async function waitForPageBusyAppear(timeout = 2000, interval = 80) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (pageIsBusy()) return true;
      await sleep(interval);
    }
    return false;
  }

  function isValidPdfHref(href) {
    return typeof href === "string" && /\/ycut\/pdf\/.+\/\.pdf\/?$/i.test(href);
  }

  async function waitForValidPdfHref(modal, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const local = modal?.querySelector?.("a#aPdf[href]");
      if (local && isValidPdfHref(local.href)) return local.href;
      const global = document.querySelector("a#aPdf[href]");
      if (global && isValidPdfHref(global.href)) return global.href;
      await sleep(120);
    }
    return null;
  }

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
    const color = getComputedStyle(icon).color;
    if (color === "rgb(187, 187, 187)") return false;
    return !!findDropdownForAnchor(anchor);
  }

  function scan() {
    const found = new Set();
    document.querySelectorAll(SEL.anchor).forEach((a) => {
      if (isBlueClickableUser(a)) found.add(a);
    });
    STATE.nodes = found;
    log("掃描完成，候選數：", STATE.nodes.size);
    updatePanelCount();
    if (STATE.highlighted) applyHighlight(true);
    if (STATE.doorplateSelectEnabled) injectDoorplateCheckboxes(true);
  }

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
    badge.textContent = "✓";
    anchor.appendChild(badge);
    anchor._ycutBadge = badge;
  }

  function removeBadge(anchor) {
    if (anchor._ycutBadge) {
      anchor._ycutBadge.remove();
      anchor._ycutBadge = null;
    }
  }

  function isDropdownVisible(dd) {
    return isVisible(dd);
  }

  async function clickOpen(anchor) {
    let dd = findDropdownForAnchor(anchor);
    try {
      anchor.scrollIntoView({ block: "center", inline: "center" });
    } catch {}
    anchor.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    anchor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await sleep(150);
    if (!dd) dd = findDropdownForAnchor(anchor);
    if (dd && isDropdownVisible(dd)) return true;
    try {
      anchor.click();
    } catch {}
    await sleep(150);
    if (!dd) dd = findDropdownForAnchor(anchor);
    return dd ? isDropdownVisible(dd) : true;
  }

  async function clickClose(anchor) {
    const dd = findDropdownForAnchor(anchor);
    if (!dd || !isDropdownVisible(dd)) return true;
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await sleep(120);
    if (!isDropdownVisible(dd)) return true;
    try {
      anchor.click();
    } catch {}
    await sleep(120);
    return !isDropdownVisible(dd);
  }

  function firstOwnerLinkOf(anchor) {
    const dd = findDropdownForAnchor(anchor);
    if (!dd) return null;
    return dd.querySelector("li a, a");
  }

  function visibleModal() {
    const cands = Array.from(document.querySelectorAll('.modal, [role="dialog"]')).filter(isVisible);
    if (!cands.length) return null;
    for (const m of cands) if ((m.textContent || "").includes("所有權人明細")) return m;
    return cands[0];
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
    } catch {}
    linkEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }


  async function clickFirstOwnerAndWaitModal(anchor) {
    const first = firstOwnerLinkOf(anchor);
    await clickOpen(anchor);
    const link = first || firstOwnerLinkOf(anchor);
    if (!link) return { opened: false, modal: null };


    invokeJsHrefIfNeeded(link);


    await waitForPageBusyAppear(2000);
    await waitForPageIdle(CONFIG.PER_ITEM_TIMEOUT_MS);

    const modal = await waitFor(() => {
      const m = visibleModal();
      if (m) return m;
      return document.querySelector("a#aPdf[href]") ? true : null;
    }, { timeout: 5000, interval: 80 });

    return { opened: !!modal, modal: modal === true ? null : modal };
  }

  function modalCloseButton(modal) {
    if (!modal) return null;
    for (const b of modal.querySelectorAll("button, a")) {
      const t = (b.innerText || b.textContent || "").trim();
      if (t === "關閉" || t === "关闭" || t.toLowerCase() === "close") return b;
    }
    return modal.querySelector('.close,[data-dismiss="modal"],[aria-label="Close"]');
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

  async function exportPdfLinksAsJson({
    delayBetween = CONFIG.DELAY_BETWEEN_MS,
    collapseAfter = true,
    perItemTimeout = CONFIG.PER_ITEM_TIMEOUT_MS,
    retries = CONFIG.MAX_RETRIES_PER_ITEM
  } = {}) {
    if (STATE.acting) return;

    const { min, max } = getAreaFilterFromPanel();
    const candidates = Array.from(STATE.nodes).filter((a) => {
      const area = getAreaFromAnchor(a);
      if (area == null) return false;
      if (min != null && area < min) return false;
      if (max != null && area > max) return false;
      if (STATE.doorplateSelectEnabled && STATE.selectedColIdx.size > 0) {
        const td = a.closest("td");
        const col = td ? td.cellIndex : null;
        if (col == null) return false;
        if (!STATE.selectedColIdx.has(col)) return false;
      }
      return true;
    });

    if (!candidates.length) {
      setPanelStatus("篩選後沒有符合建坪的戶別");
      alert("篩選後沒有任何符合建坪區間的戶別。");
      return;
    }

    STATE.acting = true;
    setPanelWorking(true, `擷取 PDF 中…（篩選後 ${candidates.length} 戶）`);

    const urls = [];
    let idx = 0;
    const total = candidates.length;

    for (const a of candidates) {
      idx++;
      updatePanelProgress(idx - 1, total);
      await waitForPageIdle(perItemTimeout);

      let got = null;
      for (let attempt = 0; attempt <= retries && !got; attempt++) {
        try {
          const { opened, modal } = await clickFirstOwnerAndWaitModal(a);
          const hrefReady = await waitForValidPdfHref(modal || null, perItemTimeout);
          got = hrefReady || extractPdfHrefFromModal(modal || null);
          if (collapseAfter && opened) await closeAll({ delay: 100 });
          await waitForPageIdle(perItemTimeout);
          if (!got) await sleep(300);
        } catch {
          await sleep(300);
        }
      }

      if (got && isValidPdfHref(got)) urls.push(got);
      updatePanelProgress(idx, total);
      await sleep(delayBetween);
    }

    const uniq = Array.from(new Set(urls));
    downloadJson(uniq, `ycut_pdf_${Date.now()}.json`);
    setPanelWorking(false, `已擷取 ${uniq.length}/${total}`);
  }

  async function recheckClickability() {
    let ok = 0;
    let bad = 0;
    for (const a of STATE.nodes) {
      try {
        const dd = findDropdownForAnchor(a);
        const before = dd ? isDropdownVisible(dd) : false;
        a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        await sleep(120);
        const after = dd ? isDropdownVisible(dd) : true;
        a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        if (!before && after) ok++;
        else if (before && !after) ok++;
        else ok++;
      } catch {
        bad++;
      }
    }
    alert(`複查完成：可點推定 ${ok}，異常 ${bad}`);
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

  function mountPanel() {
    if (document.getElementById("ycut-blue-user-panel")) return;
    const panel = document.createElement("div");
    panel.id = "ycut-blue-user-panel";
    panel.innerHTML = `
      <h4>YCUT 藍色小人掃描</h4>
      <div class="row"><span>找到數量：</span><span class="count" id="ycut-count">0</span></div>
      <div class="row">
        <span>建坪篩選：</span>
        <input id="ycut-area-min" type="number" placeholder="最小" style="width:70px;padding:4px 6px;border-radius:6px;border:1px solid #555;background:#fff;color:#000;">
        <span>~</span>
        <input id="ycut-area-max" type="number" placeholder="最大" style="width:70px;padding:4px 6px;border-radius:6px;border:1px solid #555;background:#fff;color:#000;">
      </div>
      <div class="row" style="flex-direction:column;align-items:flex-start;gap:6px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button id="ycut-doorplate-toggle">門牌勾選：關</button>
          <button id="ycut-doorplate-all">全選</button>
          <button id="ycut-doorplate-none">全不選</button>
        </div>
        <div class="muted" style="font-size:12px;">目前勾選：<span id="ycut-doorplate-selected">（未啟用）</span></div>
      </div>
      <div class="row">
        <button id="ycut-scan">重新掃描</button>
        <button id="ycut-highlight">切換高亮</button>
      </div>
      <div class="row">
        <button id="ycut-open-all">全部點開</button>
        <button id="ycut-close-all">全部收合</button>
      </div>
      <div class="row">
        <button id="ycut-open-first">點第一位(含關閉)</button>
        <button id="ycut-export-json">擷取PDF→JSON下載</button>
      </div>
      <div class="row">
        <button id="ycut-recheck">複查(點擊驗證)</button>
        <button id="ycut-close">關閉面板</button>
      </div>
      <div id="ycut-progress" class="muted">待命</div>
      <div style="font-size:12px;opacity:.75;margin-top:6px;">快捷鍵：Alt+Shift+U 高亮</div>
    `;

    document.body.appendChild(panel);

    panel.querySelector("#ycut-scan").addEventListener("click", () => {
      scan();
      setPanelStatus("已重新掃描");
    });

    panel.querySelector("#ycut-highlight").addEventListener("click", () => {
      applyHighlight(!STATE.highlighted);
    });

    panel.querySelector("#ycut-open-all").addEventListener("click", () => {
      openAll({ delay: 220 });
    });

    panel.querySelector("#ycut-close-all").addEventListener("click", () => {
      closeAll({ delay: 120 });
    });

    panel.querySelector("#ycut-open-first").addEventListener("click", () => {
      openFirstAndCloseAll({ delayBetween: 260, collapseAfter: true });
    });

    panel.querySelector("#ycut-doorplate-toggle").addEventListener("click", () => {
      STATE.doorplateSelectEnabled = !STATE.doorplateSelectEnabled;
      panel.querySelector("#ycut-doorplate-toggle").textContent = `門牌勾選：${STATE.doorplateSelectEnabled ? "開" : "關"}`;
      injectDoorplateCheckboxes(STATE.doorplateSelectEnabled);
    });

    panel.querySelector("#ycut-doorplate-all").addEventListener("click", () => {
      if (!STATE.doorplateSelectEnabled) return alert("請先把「門牌勾選」打開");
      setAllDoorplateCheckboxes(true);
    });

    panel.querySelector("#ycut-doorplate-none").addEventListener("click", () => {
      if (!STATE.doorplateSelectEnabled) return alert("請先把「門牌勾選」打開");
      setAllDoorplateCheckboxes(false);
    });

    panel.querySelector("#ycut-export-json").addEventListener("click", async () => {
      if (!(await requireLicenseForPremiumAction())) return;

      exportPdfLinksAsJson({
        delayBetween: CONFIG.DELAY_BETWEEN_MS,
        collapseAfter: true,
        perItemTimeout: CONFIG.PER_ITEM_TIMEOUT_MS,
        retries: CONFIG.MAX_RETRIES_PER_ITEM
      });
    });

    panel.querySelector("#ycut-recheck").addEventListener("click", recheckClickability);
    panel.querySelector("#ycut-close").addEventListener("click", () => panel.remove());
  }

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
    if (el) el.textContent = text || (working ? "執行中…" : "待命");
  }

  function updatePanelProgress(done, total) {
    const el = document.getElementById("ycut-progress");
    if (el) el.textContent = `進度：${done}/${total}`;
  }

  async function openAll({ max = Infinity, delay = 200 } = {}) {
    if (STATE.acting) return;
    STATE.acting = true;
    setPanelWorking(true, "點開中…");
    let done = 0;
    let ok = 0;
    for (const a of STATE.nodes) {
      if (done >= max) break;
      const okOne = await clickOpen(a);
      ok += okOne ? 1 : 0;
      done++;
      updatePanelProgress(done, STATE.nodes.size);
      await sleep(delay);
    }
    setPanelWorking(false, `已點開 ${ok}/${done}`);
  }

  async function closeAll({ delay = 120 } = {}) {
    if (STATE.acting) return;
    STATE.acting = true;
    setPanelWorking(true, "收合中…");
    let done = 0;
    let ok = 0;
    for (const a of STATE.nodes) {
      const okOne = await clickClose(a);
      ok += okOne ? 1 : 0;
      done++;
      updatePanelProgress(done, STATE.nodes.size);
      await sleep(delay);
    }
    setPanelWorking(false, `已收合 ${ok}/${done}`);
  }

  async function openFirstAndCloseAll({ delayBetween = 260, collapseAfter = true } = {}) {
    if (STATE.acting) return;
    STATE.acting = true;
    setPanelWorking(true, "點第一位中…");
    let i = 0;
    let ok = 0;
    for (const a of STATE.nodes) {
      i++;
      updatePanelProgress(i - 1, STATE.nodes.size);
      const { opened, modal } = await clickFirstOwnerAndWaitModal(a);
      if (opened && modal) {
        if (await closeModal(modal)) ok++;
      }
      if (collapseAfter) await clickClose(a);
      updatePanelProgress(i, STATE.nodes.size);
      await sleep(delayBetween);
    }
    setPanelWorking(false, `已處理 ${ok}/${STATE.nodes.size}`);
  }

  function bindHotkeys() {
    document.addEventListener("keydown", (e) => {
      if (e.altKey && e.shiftKey && e.code === "KeyU") {
        e.preventDefault();
        mountPanel();
        applyHighlight(!STATE.highlighted);
      }
    });
  }

  function watchDom() {
    if (STATE.observer) STATE.observer.disconnect();
    const ob = new MutationObserver(() => {
      if (STATE._t) clearTimeout(STATE._t);
      STATE._t = setTimeout(() => scan(), 150);
    });
    ob.observe(document.documentElement, { childList: true, subtree: true });
    STATE.observer = ob;
  }

  function init() {
    if (location.href.includes("Community.aspx")) {
      bindHotkeys();
      watchDom();
      mountPanel();
      scan();
    }
  }

  chrome.runtime?.onMessage?.addListener?.((m) => {
    if (!m || !m.type) return;
    if (m.type === "YCUT_SCAN") {
      scan();
      return true;
    }
    if (m.type === "YCUT_TOGGLE_HIGHLIGHT") {
      applyHighlight(!STATE.highlighted);
      return true;
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
