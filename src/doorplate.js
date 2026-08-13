import { STATE } from "./state.js";

function getBuAddrTable() {
  return document.querySelector("table#BuAddr");
}

export function buildDoorplateMap() {
  STATE.colIdxToDoorplate.clear();
  const table = getBuAddrTable();
  if (!table) return;
  Array.from(table.querySelectorAll("thead tr th")).forEach((th, idx) => {
    const text = (th.textContent || "").trim();
    if (text) STATE.colIdxToDoorplate.set(idx, text);
  });
}

export function injectDoorplateCheckboxes(enable) {
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
      position: "absolute", left: "6px", top: "2px",
      display: "flex", alignItems: "center", gap: "4px",
      fontSize: "12px", userSelect: "none"
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
    mini.textContent = "選";

    label.append(cb, mini);
    th.appendChild(label);
  });

  updateSelectedDoorplateText();
}

export function setAllDoorplateCheckboxes(checked) {
  const table = getBuAddrTable();
  if (!table) return;
  STATE.selectedColIdx.clear();
  Array.from(table.querySelectorAll("input.ycut-doorplate-cb")).forEach((cb) => {
    cb.checked = checked;
    if (checked) STATE.selectedColIdx.add(Number(cb.dataset.colIndex));
  });
  updateSelectedDoorplateText();
}

export function getDoorplateByColIndex(colIdx) {
  return STATE.colIdxToDoorplate.get(colIdx) || `col_${colIdx}`;
}

export function updateSelectedDoorplateText() {
  const el = document.getElementById("ycut-doorplate-selected");
  if (!el) return;
  if (!STATE.doorplateSelectEnabled) { el.textContent = "（未啟用）"; return; }
  if (STATE.selectedColIdx.size === 0) { el.textContent = "（未勾選＝全部門牌）"; return; }
  const names = Array.from(STATE.selectedColIdx)
    .sort((a, b) => a - b)
    .map(getDoorplateByColIndex);
  el.textContent = names.join("、");
}
