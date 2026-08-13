import { sleep } from "./config.js";
import { STATE } from "./state.js";
import { clickOpen, clickClose, clickFirstOwnerAndWaitModal, closeModal } from "./interactions.js";
import { setPanelWorking, updatePanelProgress } from "./panel.js";

export async function openAll({ max = Infinity, delay = 200 } = {}) {
  if (STATE.acting) return;
  STATE.acting = true;
  setPanelWorking(true, "點開中…");
  let done = 0;
  let ok = 0;
  for (const a of STATE.nodes) {
    if (done >= max) break;
    if (await clickOpen(a)) ok++;
    done++;
    updatePanelProgress(done, STATE.nodes.size);
    await sleep(delay);
  }
  setPanelWorking(false, `已點開 ${ok}/${done}`);
}

export async function closeAll({ delay = 120 } = {}) {
  if (STATE.acting) return;
  STATE.acting = true;
  setPanelWorking(true, "收合中…");
  let done = 0;
  let ok = 0;
  for (const a of STATE.nodes) {
    if (await clickClose(a)) ok++;
    done++;
    updatePanelProgress(done, STATE.nodes.size);
    await sleep(delay);
  }
  setPanelWorking(false, `已收合 ${ok}/${done}`);
}

export async function openFirstAndCloseAll({ delayBetween = 260, collapseAfter = true } = {}) {
  if (STATE.acting) return;
  STATE.acting = true;
  setPanelWorking(true, "點第一位中…");
  let i = 0;
  let ok = 0;
  for (const a of STATE.nodes) {
    updatePanelProgress(i, STATE.nodes.size);
    const { opened, modal } = await clickFirstOwnerAndWaitModal(a);
    if (opened && modal && await closeModal(modal)) ok++;
    if (collapseAfter) await clickClose(a);
    updatePanelProgress(++i, STATE.nodes.size);
    await sleep(delayBetween);
  }
  setPanelWorking(false, `已處理 ${ok}/${STATE.nodes.size}`);
}
