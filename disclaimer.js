import {
  getDisclaimerAccepted,
  saveDisclaimerAccepted
} from './src/disclaimer.js';

const COMMUNITY_URL_FRAGMENT = '/magent/Community.aspx';

const scrollArea = document.getElementById('disclaimer-scroll');
const scrollHint = document.getElementById('scroll-hint');
const agreementCheck = document.getElementById('agreement-check');
const acceptButton = document.getElementById('accept-button');
const retryButton = document.getElementById('retry-button');
const cancelButton = document.getElementById('cancel-button');
const pageStatus = document.getElementById('page-status');

const state = {
  reachedBottom: false,
  processing: false,
  acceptedPersisted: false
};

function showStatus(message, type = '') {
  pageStatus.textContent = message;
  pageStatus.className = `page-status${type ? ` ${type}` : ''}`;
}

function refreshControls() {
  acceptButton.disabled = state.processing || state.acceptedPersisted ||
    !(state.reachedBottom && agreementCheck.checked);
  retryButton.disabled = state.processing;
  cancelButton.disabled = state.processing;
}

function checkScrollPosition() {
  if (state.reachedBottom) return;
  const atBottom = scrollArea.scrollTop + scrollArea.clientHeight >= scrollArea.scrollHeight - 5;
  const allVisible = scrollArea.scrollHeight <= scrollArea.clientHeight + 5;
  if (!atBottom && !allVisible) return;

  state.reachedBottom = true;
  agreementCheck.disabled = false;
  scrollHint.textContent = allVisible
    ? '✓ 已顯示全部內容，請勾選下方同意聲明'
    : '✓ 已捲動到底，請勾選下方同意聲明';
  scrollHint.classList.add('complete');
  refreshControls();
}

async function findCommunityTab() {
  const [currentTab, tabs] = await Promise.all([
    chrome.tabs.getCurrent().catch(() => null),
    chrome.tabs.query({})
  ]);
  const matches = tabs.filter((tab) =>
    Number.isInteger(tab.id) && String(tab.url || '').includes(COMMUNITY_URL_FRAGMENT)
  );
  if (!matches.length) return null;

  return matches.find((tab) => tab.windowId === currentTab?.windowId && tab.active) ||
    matches.find((tab) => tab.windowId === currentTab?.windowId) ||
    matches.find((tab) => tab.active) ||
    matches[0];
}

async function focusCommunityTab(tab) {
  if (!Number.isInteger(tab?.id)) throw new Error('Community.aspx tab is invalid.');
  if (Number.isInteger(tab.windowId)) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  await chrome.tabs.update(tab.id, { active: true });

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'YCUT_DISCLAIMER_ACCEPTED' });
  } catch {
    // The tab may predate the current extension load. Reloading makes the
    // manifest content script re-check license and disclaimer storage.
    await chrome.tabs.reload(tab.id);
  }
}

async function closeCurrentDisclaimerTab() {
  const currentTab = await chrome.tabs.getCurrent();
  if (!Number.isInteger(currentTab?.id)) {
    window.close();
    throw new Error('Unable to resolve the disclaimer tab.');
  }

  try {
    await chrome.tabs.remove(currentTab.id);
  } catch (error) {
    window.close();
    throw error;
  }
}

async function completeDisclaimerFlow({ saveAcceptance = true } = {}) {
  if (state.processing) return;
  if (saveAcceptance && (!state.reachedBottom || !agreementCheck.checked)) return;

  state.processing = true;
  retryButton.hidden = true;
  refreshControls();

  try {
    if (saveAcceptance && !state.acceptedPersisted) {
      showStatus('正在儲存同意紀錄…');
      await saveDisclaimerAccepted();
      state.acceptedPersisted = true;
      acceptButton.textContent = '已完成同意';
    }

    const communityTab = await findCommunityTab();
    if (communityTab) {
      try {
        await focusCommunityTab(communityTab);
      } catch (error) {
        console.error('切換 Community.aspx 失敗：', error);
      }
    }

    await closeCurrentDisclaimerTab();
  } catch (error) {
    console.error(error);
    if (!state.acceptedPersisted) {
      state.processing = false;
      showStatus('無法儲存同意紀錄，請確認擴充功能儲存權限後再試。', 'error');
      refreshControls();
      return;
    }

    try {
      await closeCurrentDisclaimerTab();
    } catch {
      state.processing = false;
      showStatus('同意已儲存，但無法自動關閉此分頁，請手動關閉。', 'error');
      refreshControls();
    }
  }
}

scrollArea.addEventListener('scroll', checkScrollPosition, { passive: true });
window.addEventListener('resize', checkScrollPosition);
agreementCheck.addEventListener('change', refreshControls);
acceptButton.addEventListener('click', () => completeDisclaimerFlow({ saveAcceptance: true }));
retryButton.addEventListener('click', () => completeDisclaimerFlow({ saveAcceptance: false }));
cancelButton.addEventListener('click', async () => {
  if (state.processing) return;
  try {
    await closeCurrentDisclaimerTab();
  } catch {
    showStatus('無法自動關閉此頁面，請手動關閉分頁。', 'error');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') event.preventDefault();
}, true);

requestAnimationFrame(checkScrollPosition);
scrollArea.focus({ preventScroll: true });

getDisclaimerAccepted().then(async (accepted) => {
  if (!accepted) return;
  state.acceptedPersisted = true;
  await completeDisclaimerFlow({ saveAcceptance: false });
}).catch((error) => {
  console.error(error);
});
