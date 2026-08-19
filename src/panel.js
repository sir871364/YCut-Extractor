import { STATE } from "./state.js";

export function updatePanelCount() {
  const el = document.getElementById("ycut-count");
  if (el) el.textContent = String(STATE.nodes.size);
}

export function setPanelStatus(text) {
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
      <div id="ycut-route-current">正在掃描路段：-</div>
      <div class="ycut-route-meta">
        <span id="ycut-route-count">分頁進度：0 / 0</span>
        <span id="ycut-route-found">目前找到：0</span>
        <span id="ycut-route-failed">目前失敗：0</span>
      </div>
    </div>
    <div id="ycut-database-progress" hidden>
      <div id="ycut-db-route">目前路段：0 / 0</div>
      <div class="ycut-database-meta">
        <span id="ycut-db-households">掃描戶別：0 / 0</span>
        <span id="ycut-db-success">API成功：0</span>
        <span id="ycut-db-retries">API重試：0</span>
        <span id="ycut-db-failed">API失敗：0</span>
        <span id="ycut-db-pdf">有效PDF：0</span>
        <span id="ycut-db-duplicates">重複略過：0</span>
      </div>
    </div>
    <div class="ycut-progress-meta">
      <span id="ycut-progress-count">0/0</span>
      <span id="ycut-progress-eta">估算中</span>
    </div>
    <div class="ycut-progress-track">
      <div id="ycut-progress-bar"></div>
    </div>
    <div id="ycut-progress-stage">狀態：待命</div>
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

export function updateRouteProgress({
  routeName = "-",
  index = 0,
  total = 0,
  found = 0,
  failed = 0,
  groupNumber = 0,
  totalGroups = 0
} = {}) {
  ensureProgressUi();
  setText("ycut-route-current", `正在掃描路段：${routeName}`);
  const groupSuffix = totalGroups > 1 ? `（棟別 ${groupNumber} / ${totalGroups}）` : "";
  setText("ycut-route-count", `分頁進度：${index} / ${total}${groupSuffix}`);
  setText("ycut-route-found", `目前找到：${found}`);
  setText("ycut-route-failed", `目前失敗：${failed}`);
}

export function setProgressMode(mode) {
  ensureProgressUi();
  const database = mode === "database";
  const legacyBox = document.getElementById("ycut-legacy-progress");
  const databaseBox = document.getElementById("ycut-database-progress");
  if (legacyBox) legacyBox.hidden = database;
  if (databaseBox) databaseBox.hidden = !database;
}

export function updateDatabaseProgress({
  routeNumber = 0,
  totalRoutes = 0,
  scannedHouseholds = 0,
  totalHouseholds = 0,
  apiSuccess = 0,
  apiRetries = 0,
  apiFailed = 0,
  validPdf = 0,
  duplicateSkipped = 0,
  groupNumber = 0,
  totalGroups = 0,
  phase = "準備中"
} = {}) {
  ensureProgressUi();
  const groupSuffix = totalGroups > 1 ? ` · 棟別：${groupNumber} / ${totalGroups}` : "";
  setText("ycut-db-route", `目前路段：${routeNumber} / ${totalRoutes}${groupSuffix}`);
  setText("ycut-db-households", `掃描戶別：${scannedHouseholds} / ${totalHouseholds}`);
  setText("ycut-db-success", `API成功：${apiSuccess}`);
  setText("ycut-db-retries", `API重試：${apiRetries}`);
  setText("ycut-db-failed", `API失敗：${apiFailed}`);
  setText("ycut-db-pdf", `有效PDF：${validPdf}`);
  setText("ycut-db-duplicates", `重複略過：${duplicateSkipped}`);
  setText("ycut-progress-stage", `狀態：${phase}`);

  const percent = totalHouseholds ? Math.round((scannedHouseholds / totalHouseholds) * 100) : 0;
  setText("ycut-progress-count", `${scannedHouseholds}/${totalHouseholds} · ${percent}%`);
  setText("ycut-progress-eta", scannedHouseholds >= totalHouseholds && totalHouseholds > 0 ? "完成" : "處理中");
  const bar = document.getElementById("ycut-progress-bar");
  if (bar) {
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    bar.classList.toggle("is-complete", scannedHouseholds >= totalHouseholds && totalHouseholds > 0);
  }
}

function formatEta(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "估算中";
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `約 ${sec} 秒`;
  const min = Math.floor(sec / 60);
  const remain = sec % 60;
  return remain ? `約 ${min} 分 ${remain} 秒` : `約 ${min} 分`;
}

export function setPanelWorking(working, text) {
  STATE.acting = working;
  ensureProgressUi();

  const el = document.getElementById("ycut-progress");
  if (el) el.textContent = text || (working ? "執行中..." : "待命");

  const box = document.getElementById("ycut-progress-box");
  if (box) box.classList.toggle("is-working", !!working);
}

export function updatePanelProgress(done, total, detail = {}) {
  ensureProgressUi();

  const startedAt = detail.startedAt || STATE.extractStartedAt || Date.now();
  const percent = total ? Math.round((done / total) * 100) : 0;
  const elapsed = Date.now() - startedAt;
  const eta = done > 0 && done < total
    ? formatEta((elapsed / done) * (total - done))
    : (done >= total && total > 0 ? "完成" : "估算中");

  const el = document.getElementById("ycut-progress");
  if (el) el.textContent = detail.title || "擷取 PDF 中";

  setText("ycut-progress-count", `${done}/${total} · ${percent}%`);
  setText("ycut-progress-eta", eta);
  setText("ycut-progress-stage", `狀態：${detail.stage || "執行中"}`);

  const bar = document.getElementById("ycut-progress-bar");
  if (bar) {
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    bar.classList.toggle("is-complete", done >= total && total > 0);
  }
}

export function resetPanelProgress(total, detail = {}) {
  STATE.extractStartedAt = Date.now();
  updatePanelProgress(0, total, {
    title: detail.title || "擷取 PDF 中",
    current: detail.current || "-",
    stage: detail.stage || "準備中",
    startedAt: STATE.extractStartedAt
  });
}

export function markAnchorExtractionState(anchor, state) {
  const cell = anchor?.closest?.("td");
  if (!cell) return;
  cell.classList.remove("ycut-extract-active", "ycut-extract-done", "ycut-extract-failed");
  if (state) cell.classList.add(`ycut-extract-${state}`);
}

export function clearExtractionStates() {
  document.querySelectorAll(".ycut-extract-active,.ycut-extract-done,.ycut-extract-failed")
    .forEach((el) => el.classList.remove("ycut-extract-active", "ycut-extract-done", "ycut-extract-failed"));
}

const SCAN_ALL_GROUPS_KEY = "ycut_scan_all_groups";

// 進階功能（建立PDF資料庫、匯出失敗清單）預設藏起來，
// 用 Ctrl + Shift + 左鍵點面板標題切換顯示／隱藏。
// 按鈕本身一直留在 DOM 裡（只是 hidden），這樣「掃描中禁用」等狀態管理完全不用改動。
// 想讓它們一開始就顯示，把這個改成 false。
const ADVANCED_HIDDEN_BY_DEFAULT = true;

/** 切換進階按鈕的顯示；隱藏時該列改為單欄，剩下的按鈕撐滿不留空格 */
function setAdvancedActionsVisible(visible) {
  const panel = document.getElementById("ycut-blue-user-panel");
  if (!panel) return;
  ["ycut-build-database", "ycut-export-failures"].forEach((id) => {
    const button = panel.querySelector(`#${id}`);
    if (button) button.hidden = !visible;
  });
  panel.querySelectorAll(".ycut-run-grid").forEach((grid) => {
    grid.classList.toggle("ycut-grid-1", !visible);
  });
  panel.dataset.advanced = visible ? "on" : "off";
}

/**
 * 面板顯示的是「這一頁正在跑的 content script」屬於哪一版。
 * 擴充被重新載入後，舊的 content script 會失去 runtime 連線，
 * 這裡就會取不到版本 —— 那正是「該重整頁面了」的訊號，不要吞掉。
 */
function getRunningVersion() {
  try {
    const version = chrome.runtime?.getManifest?.()?.version;
    return version ? { label: `v${version}`, stale: false } : { label: "v?", stale: true };
  } catch {
    return { label: "v?", stale: true };
  }
}

/** 擴充還活著嗎？被更新／重新載入／停用後，chrome.runtime.id 會消失或直接丟例外 */
function extensionContextAlive() {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

const STALE_HINT = "擴充已更新或重新載入，這一頁跑的是舊程式碼，請按 F5 重整";

function markContextStale() {
  const badge = document.querySelector("#ycut-blue-user-panel .ycut-version");
  if (badge && !badge.classList.contains("is-stale")) {
    badge.textContent = "v?";
    badge.classList.add("is-stale");
    badge.title = STALE_HINT;
  }
  const foot = document.querySelector("#ycut-blue-user-panel .ycut-foot > span");
  if (foot) {
    foot.textContent = "⚠ 擴充已更新，請按 F5 重整頁面";
    foot.classList.add("is-stale");
  }
}

/**
 * 失聯通常發生在面板建立「之後」（商店自動更新會在背景推），
 * 所以不能只在掛載時檢查一次，要持續盯著。
 */
function watchExtensionContext() {
  if (!extensionContextAlive()) {
    markContextStale();
    return;
  }
  const timer = setInterval(() => {
    if (extensionContextAlive()) return;
    markContextStale();
    clearInterval(timer);
  }, 10000);
}

/** 掃描時是否要跑過所有棟別（面板勾選框，關閉時只掃目前這一棟） */
export function getScanAllGroups() {
  try {
    return localStorage.getItem(SCAN_ALL_GROUPS_KEY) !== "0";
  } catch {
    return true;
  }
}

/** 兩種掃描共用同一顆取消鈕：執行中才可按 */
export function setCancelEnabled(enabled) {
  const button = document.getElementById("ycut-cancel-scan");
  if (button) button.disabled = !enabled;
}

export function mountPanel({
  onScan, onHighlight, onAutoFollow,
  onDoorplateToggle, onDoorplateAll, onDoorplateNone, onExport,
  onBuildDatabase, onCancelScan, onExportFailures
}) {
  if (document.getElementById("ycut-blue-user-panel")) return;

  const version = getRunningVersion();
  const panel = document.createElement("div");
  panel.id = "ycut-blue-user-panel";
  panel.innerHTML = `
    <div class="ycut-head">
      <h4>YCUT 藍色小人掃描 <span class="ycut-version${version.stale ? " is-stale" : ""}"
        title="${version.stale ? STALE_HINT : "這一頁目前執行中的版本"}">${version.label}</span></h4>
      <span class="ycut-count-chip">本頁 <span class="count" id="ycut-count">0</span></span>
    </div>

    <div class="ycut-section">
      <div class="ycut-section-title">篩選</div>
      <div class="ycut-field">
        <label for="ycut-area-min">建坪</label>
        <input id="ycut-area-min" type="number" placeholder="最小">
        <span class="ycut-tilde">~</span>
        <input id="ycut-area-max" type="number" placeholder="最大">
      </div>
      <div class="ycut-btn-grid ycut-grid-3">
        <button id="ycut-doorplate-toggle"${STATE.doorplateSelectEnabled ? ' class="is-on"' : ""}>門牌勾選：${STATE.doorplateSelectEnabled ? "開" : "關"}</button>
        <button id="ycut-doorplate-all">全選</button>
        <button id="ycut-doorplate-none">全不選</button>
      </div>
      <div class="ycut-hint">已勾選門牌：<span id="ycut-doorplate-selected">（未啟用）</span></div>
      <label class="ycut-check" for="ycut-scan-all-groups">
        <input type="checkbox" id="ycut-scan-all-groups" checked>
        <span>掃描全部棟別<em>關閉時只掃目前棟別</em></span>
      </label>
    </div>

    <div class="ycut-section">
      <div class="ycut-section-title">檢視</div>
      <div class="ycut-btn-grid ycut-grid-3">
        <button id="ycut-scan">重新掃描</button>
        <button id="ycut-highlight">切換高亮</button>
        <button id="ycut-auto-follow"${STATE.autoFollow ? "" : ' class="is-off"'}>跟隨：${STATE.autoFollow ? "開" : "關"}</button>
      </div>
    </div>

    <div class="ycut-section">
      <div class="ycut-section-title">執行</div>
      <div class="ycut-btn-grid ycut-run-grid${ADVANCED_HIDDEN_BY_DEFAULT ? " ycut-grid-1" : ""}">
        <button id="ycut-export-json" class="is-primary">擷取PDF→JSON</button>
        <button id="ycut-build-database" class="is-primary"${ADVANCED_HIDDEN_BY_DEFAULT ? " hidden" : ""}>建立PDF資料庫</button>
      </div>
      <div class="ycut-btn-grid ycut-run-grid${ADVANCED_HIDDEN_BY_DEFAULT ? " ycut-grid-1" : ""}">
        <button id="ycut-cancel-scan" class="is-danger" disabled>取消掃描</button>
        <button id="ycut-export-failures" disabled${ADVANCED_HIDDEN_BY_DEFAULT ? " hidden" : ""}>匯出失敗清單</button>
      </div>
    </div>

    <div id="ycut-progress" class="muted">待命</div>

    <div class="ycut-foot">
      <span${version.stale ? ' class="is-stale"' : ""}>${version.stale ? "⚠ 擴充已更新，請按 F5 重整頁面" : "快捷鍵 Alt+Shift+U"}</span>
      <button id="ycut-close" class="is-ghost">關閉</button>
    </div>
  `;

  document.body.appendChild(panel);
  ensureProgressUi();
  watchExtensionContext();

  panel.querySelector("#ycut-scan").addEventListener("click", onScan);
  panel.querySelector("#ycut-highlight").addEventListener("click", onHighlight);
  panel.querySelector("#ycut-auto-follow").addEventListener("click", () => {
    STATE.autoFollow = !STATE.autoFollow;
    const button = panel.querySelector("#ycut-auto-follow");
    button.textContent = `跟隨：${STATE.autoFollow ? "開" : "關"}`;
    // 只有「關」需要視覺提示：預設是開，關掉才是需要被看見的非預設狀態
    button.classList.toggle("is-off", !STATE.autoFollow);
    onAutoFollow?.(STATE.autoFollow);
  });
  panel.querySelector("#ycut-export-json").addEventListener("click", onExport);
  panel.querySelector("#ycut-build-database").addEventListener("click", onBuildDatabase);

  // 隱藏入口：Ctrl + Shift + 左鍵點面板標題 → 切換進階功能的顯示
  panel.dataset.advanced = ADVANCED_HIDDEN_BY_DEFAULT ? "off" : "on";
  panel.querySelector("h4").addEventListener("click", (event) => {
    if (!event.ctrlKey || !event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const nowVisible = panel.dataset.advanced !== "on";
    setAdvancedActionsVisible(nowVisible);
    setPanelStatus(nowVisible ? "已顯示進階功能" : "已隱藏進階功能");
  });
  panel.querySelector("#ycut-cancel-scan").addEventListener("click", () => onCancelScan?.());
  panel.querySelector("#ycut-export-failures").addEventListener("click", onExportFailures);
  panel.querySelector("#ycut-close").addEventListener("click", () => panel.remove());

  const groupToggle = panel.querySelector("#ycut-scan-all-groups");
  groupToggle.checked = getScanAllGroups();
  groupToggle.addEventListener("change", () => {
    try { localStorage.setItem(SCAN_ALL_GROUPS_KEY, groupToggle.checked ? "1" : "0"); } catch {}
  });

  panel.querySelector("#ycut-doorplate-toggle").addEventListener("click", () => {
    STATE.doorplateSelectEnabled = !STATE.doorplateSelectEnabled;
    const button = panel.querySelector("#ycut-doorplate-toggle");
    button.textContent = `門牌勾選：${STATE.doorplateSelectEnabled ? "開" : "關"}`;
    // 這裡的預設是「關」，所以要標示的是「開」＝篩選生效中，跟「跟隨」剛好相反
    button.classList.toggle("is-on", STATE.doorplateSelectEnabled);
    onDoorplateToggle(STATE.doorplateSelectEnabled);
  });

  panel.querySelector("#ycut-doorplate-all").addEventListener("click", () => {
    if (!STATE.doorplateSelectEnabled) {
      alert("請先把「門牌勾選」打開");
      return;
    }
    onDoorplateAll();
  });

  panel.querySelector("#ycut-doorplate-none").addEventListener("click", () => {
    if (!STATE.doorplateSelectEnabled) {
      alert("請先把「門牌勾選」打開");
      return;
    }
    onDoorplateNone();
  });
}
