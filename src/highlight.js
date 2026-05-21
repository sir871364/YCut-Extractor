import { STATE } from "./state.js";

export function applyHighlight(on) {
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

export function ensureBadge(anchor) {
  if (anchor._ycutBadge) return;
  if (getComputedStyle(anchor).position === "static") anchor.style.position = "relative";
  const badge = document.createElement("span");
  badge.className = "ycut-blue-user-badge";
  badge.textContent = "✓";
  anchor.appendChild(badge);
  anchor._ycutBadge = badge;
}

export function removeBadge(anchor) {
  if (anchor._ycutBadge) {
    anchor._ycutBadge.remove();
    anchor._ycutBadge = null;
  }
}
