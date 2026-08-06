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

export function updateRouteProgress({ routeName = "-", index = 0, total = 0, found = 0, failed = 0 } = {}) {
  ensureProgressUi();
  setText("ycut-route-current", `正在掃描路段：${routeName}`);
  setText("ycut-route-count", `分頁進度：${index} / ${total}`);
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
  phase = "準備中"
} = {}) {
  ensureProgressUi();
  setText("ycut-db-route", `目前路段：${routeNumber} / ${totalRoutes}`);
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

export function mountPanel({
  onScan, onHighlight, onAutoFollow,
  onDoorplateToggle, onDoorplateAll, onDoorplateNone, onExport,
  onBuildDatabase, onCancelDatabase, onExportFailures
}) {
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
      <button id="ycut-auto-follow">自動跟隨：開</button>
      <button id="ycut-export-json">擷取PDF→JSON下載</button>
    </div>
    <div class="row">
      <button id="ycut-build-database">建立PDF資料庫</button>
    </div>
    <div class="row">
      <button id="ycut-cancel-database" disabled>取消資料庫掃描</button>
      <button id="ycut-export-failures" disabled>匯出失敗清單</button>
    </div>
    <div class="row">
      <button id="ycut-close">關閉面板</button>
    </div>
    <div id="ycut-progress" class="muted">待命</div>
    <div style="font-size:12px;opacity:.75;margin-top:6px;">快捷鍵：Alt+Shift+U 高亮</div>
  `;

  document.body.appendChild(panel);
  ensureProgressUi();

  panel.querySelector("#ycut-scan").addEventListener("click", onScan);
  panel.querySelector("#ycut-highlight").addEventListener("click", onHighlight);
  panel.querySelector("#ycut-auto-follow").addEventListener("click", () => {
    STATE.autoFollow = !STATE.autoFollow;
    panel.querySelector("#ycut-auto-follow").textContent =
      `自動跟隨：${STATE.autoFollow ? "開" : "關"}`;
    onAutoFollow?.(STATE.autoFollow);
  });
  panel.querySelector("#ycut-export-json").addEventListener("click", onExport);
  panel.querySelector("#ycut-build-database").addEventListener("click", onBuildDatabase);
  panel.querySelector("#ycut-cancel-database").addEventListener("click", onCancelDatabase);
  panel.querySelector("#ycut-export-failures").addEventListener("click", onExportFailures);
  panel.querySelector("#ycut-close").addEventListener("click", () => panel.remove());

  panel.querySelector("#ycut-doorplate-toggle").addEventListener("click", () => {
    STATE.doorplateSelectEnabled = !STATE.doorplateSelectEnabled;
    panel.querySelector("#ycut-doorplate-toggle").textContent =
      `門牌勾選：${STATE.doorplateSelectEnabled ? "開" : "關"}`;
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
