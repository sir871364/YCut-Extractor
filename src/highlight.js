import { STATE } from "./state.js";

export function applyHighlight(on) {
  const nodes = Array.from(STATE.nodes);
  nodes.forEach((anchor, index) => {
    if (on) {
      anchor.classList.add("ycut-blue-user-highlight");
      ensureBadge(anchor, index + 1, nodes.length);
    } else {
      anchor.classList.remove("ycut-blue-user-highlight");
      removeBadge(anchor);
    }
  });
  STATE.highlighted = on;
}

export function ensureBadge(anchor, order = null, total = 0) {
  if (getComputedStyle(anchor).position === "static") anchor.style.position = "relative";

  let badge = anchor._ycutBadge;
  if (!badge || !badge.isConnected) {
    badge = document.createElement("span");
    badge.className = "ycut-blue-user-badge";
    anchor.appendChild(badge);
    anchor._ycutBadge = badge;
  }

  // 換路段／換棟別後重新掃描，編號會整個重來，
  // 所以不能像舊版那樣「已有徽章就 return」，每次都要更新內容
  const label = order == null ? "✓" : String(order);
  if (badge.textContent !== label) badge.textContent = label;
  badge.title = order == null ? "" : `第 ${order} 個，本頁共 ${total} 個`;
  badge.classList.toggle("is-wide", label.length >= 3);
}

export function removeBadge(anchor) {
  if (anchor._ycutBadge) {
    anchor._ycutBadge.remove();
    anchor._ycutBadge = null;
  }
}
