// background.js - YCUT Blue User Scanner

// 安裝時目前沒特別要做的事，保留空 listener
chrome.runtime.onInstalled.addListener(() => {
  // 可以在這裡放首次安裝初始化
});

// 收到 content script 的要求，就在「頁面世界 (MAIN)」覆寫 alert / confirm / prompt
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type !== 'YCUT_AUTOCONFIRM') return;

  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return;

  chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",          // 重點：在 MAIN world 執行，就跟書籤一樣
    func: () => {
      // 這裡就是你原本書籤裡的內容
      window.confirm = () => true;
      window.alert   = () => {};
      window.prompt  = () => null;
      console.log('[YCUT AutoConfirm MAIN world 啟動]');
    }
  });
});
