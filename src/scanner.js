import { SEL } from "./config.js";
import { STATE } from "./state.js";
import { isVisible } from "./utils.js";
import { applyHighlight } from "./highlight.js";
import { injectDoorplateCheckboxes } from "./doorplate.js";
import { updatePanelCount } from "./panel.js";
import { log } from "./config.js";

export function findDropdownForAnchor(anchor) {
  if (!anchor) return null;
  const cell = anchor.closest("td");
  if (!cell) return null;
  return cell.querySelector(SEL.dropdown);
}

export function isBlueClickableUser(anchor) {
  if (!anchor || anchor.tagName !== "A") return false;
  const icon = anchor.querySelector(SEL.iconUser);
  if (!icon) return false;
  if (getComputedStyle(icon).color === "rgb(187, 187, 187)") return false;
  return !!findDropdownForAnchor(anchor);
}

export function scan() {
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

export function getAreaFromCell(td) {
  try {
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

export function getAreaFromAnchor(anchor) {
  return getAreaFromCell(anchor?.closest?.("td"));
}

export function getAreaFilterFromPanel() {
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
