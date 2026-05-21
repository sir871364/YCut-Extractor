import { STATE } from "./state.js";

export function updatePanelCount() {
  const el = document.getElementById("ycut-count");
  if (el) el.textContent = String(STATE.nodes.size);
}

export function setPanelStatus(text) {
  const el = document.getElementById("ycut-progress");
  if (el) el.textContent = text;
}

export function setPanelWorking(working, text) {
  STATE.acting = working;
  const el = document.getElementById("ycut-progress");
  if (el) el.textContent = text || (working ? "執行中…" : "待命");
}

export function updatePanelProgress(done, total) {
  const el = document.getElementById("ycut-progress");
  if (el) el.textContent = `進度：${done}/${total}`;
}

export function mountPanel({
  onScan, onHighlight, onAutoFollow,
  onDoorplateToggle, onDoorplateAll, onDoorplateNone, onExport
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
      <button id="ycut-close">關閉面板</button>
    </div>
    <div id="ycut-progress" class="muted">待命</div>
    <div style="font-size:12px;opacity:.75;margin-top:6px;">快捷鍵：Alt+Shift+U 高亮</div>
  `;

  document.body.appendChild(panel);

  panel.querySelector("#ycut-scan").addEventListener("click", onScan);
  panel.querySelector("#ycut-highlight").addEventListener("click", onHighlight);
  panel.querySelector("#ycut-auto-follow").addEventListener("click", () => {
    STATE.autoFollow = !STATE.autoFollow;
    panel.querySelector("#ycut-auto-follow").textContent =
      `自動跟隨：${STATE.autoFollow ? "開" : "關"}`;
    onAutoFollow?.(STATE.autoFollow);
  });
  panel.querySelector("#ycut-export-json").addEventListener("click", onExport);
  panel.querySelector("#ycut-close").addEventListener("click", () => panel.remove());

  panel.querySelector("#ycut-doorplate-toggle").addEventListener("click", () => {
    STATE.doorplateSelectEnabled = !STATE.doorplateSelectEnabled;
    panel.querySelector("#ycut-doorplate-toggle").textContent =
      `門牌勾選：${STATE.doorplateSelectEnabled ? "開" : "關"}`;
    onDoorplateToggle(STATE.doorplateSelectEnabled);
  });

  panel.querySelector("#ycut-doorplate-all").addEventListener("click", () => {
    if (!STATE.doorplateSelectEnabled) { alert("請先把「門牌勾選」打開"); return; }
    onDoorplateAll();
  });

  panel.querySelector("#ycut-doorplate-none").addEventListener("click", () => {
    if (!STATE.doorplateSelectEnabled) { alert("請先把「門牌勾選」打開"); return; }
    onDoorplateNone();
  });
}
