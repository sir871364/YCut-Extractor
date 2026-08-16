import { STATE } from "./state.js";

function getBuAddrTable() {
  return document.querySelector("table#BuAddr");
}

/** 取表頭的門牌文字；注入勾選框後 th 裡會多出「選」字，要排除掉 */
function headerDoorplateText(th) {
  return (th?.childNodes?.[0]?.textContent || th?.textContent || "")
    .replace(/^選\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 找出某個儲存格所屬的門牌（沿欄位往上找含「號」的表頭） */
export function getDoorplateForCell(cell) {
  if (!cell) return "";
  const tables = [cell.closest("table"), getBuAddrTable()]
    .filter((table, index, items) => table && items.indexOf(table) === index);
  for (const table of tables) {
    for (const row of Array.from(table.rows || [])) {
      const header = row.cells?.[cell.cellIndex];
      if (!header || header === cell) continue;
      const text = headerDoorplateText(header);
      if (text.includes("號")) return text;
    }
  }
  return "";
}

export function buildDoorplateMap() {
  STATE.colIdxToDoorplate.clear();
  const table = getBuAddrTable();
  if (!table) return;
  Array.from(table.querySelectorAll("thead tr th")).forEach((th, idx) => {
    const text = headerDoorplateText(th);
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
    const name = STATE.colIdxToDoorplate.get(idx) || "";
    // 勾選狀態跟著「門牌」走，換路段後同一個門牌仍然是勾的，
    // 而不是把上一頁第 N 欄的勾選硬套到這一頁的第 N 欄
    const selected = !!name && STATE.selectedDoorplates.has(name);

    if (!enable) {
      if (existed) existed.closest("label")?.remove();
      th.style.position = "";
      th.style.paddingTop = "";
      return;
    }

    if (existed) {
      existed.checked = selected;
      return;
    }

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
    cb.dataset.doorplate = name;
    cb.checked = selected;

    cb.addEventListener("change", () => {
      const doorplate = cb.dataset.doorplate || "";
      if (cb.checked) {
        if (doorplate) STATE.selectedDoorplates.add(doorplate);
      } else if (doorplate) {
        STATE.selectedDoorplates.delete(doorplate);
      }
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
  // 只動目前這張表看得到的門牌，其他棟別先前的勾選不受影響
  Array.from(table.querySelectorAll("input.ycut-doorplate-cb")).forEach((cb) => {
    cb.checked = checked;
    const doorplate = cb.dataset.doorplate || "";
    if (checked) {
      if (doorplate) STATE.selectedDoorplates.add(doorplate);
    } else if (doorplate) {
      STATE.selectedDoorplates.delete(doorplate);
    }
  });
  updateSelectedDoorplateText();
}

export function getDoorplateByColIndex(colIdx) {
  return STATE.colIdxToDoorplate.get(colIdx) || `col_${colIdx}`;
}

export function updateSelectedDoorplateText() {
  const el = document.getElementById("ycut-doorplate-selected");
  if (!el) return;
  // 提示文字與按鈕是同一個狀態的兩種呈現，一起亮起來才不會各說各話
  el.closest(".ycut-hint")?.classList.toggle("is-on", STATE.doorplateSelectEnabled);
  if (!STATE.doorplateSelectEnabled) { el.textContent = "（未啟用）"; return; }
  if (STATE.selectedDoorplates.size === 0) { el.textContent = "（未勾選＝全部門牌）"; return; }
  el.textContent = Array.from(STATE.selectedDoorplates).sort().join("、");
}
