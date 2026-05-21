const LICENSE_REQUEST_API = 'https://ycut-license-api.sir8713642.workers.dev/api/request-license';
const LICENSE_STATUS_API = 'https://ycut-license-api.sir8713642.workers.dev/api/license-status';
const PRODUCT_ID = 'ycut_extractor';

const QR_LIFETIME_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;

const $ = (id) => document.getElementById(id);

let qrExpireAt = 0;
let qrTimerId = null;
let pollTimerId = null;

function setStatus(message, ok = false) {
  const el = $('licenseStatus');
  if (!el) return;
  el.textContent = message;
  el.className = ok ? 'status ok' : 'status bad';
}

function setToolEnabled(enabled) {
  $('scan').disabled = !enabled;
  $('toggle').disabled = !enabled;
}

function showLicensePanel(message) {
  const panel = $('licensePanel');
  if (panel) panel.style.display = 'block';
  if (message) setStatus(message, false);
}

function hideLicensePanel() {
  const panel = $('licensePanel');
  if (panel) panel.style.display = 'none';
}

async function getOrCreateInstallId() {
  const stored = await chrome.storage.local.get(['install_id']);

  if (stored.install_id) {
    return stored.install_id;
  }

  const installId = crypto.randomUUID();
  await chrome.storage.local.set({ install_id: installId });
  return installId;
}

async function checkQrLicenseStatus() {
  const installId = await getOrCreateInstallId();
  const url = LICENSE_STATUS_API +
    '?product_id=' + encodeURIComponent(PRODUCT_ID) +
    '&install_id=' + encodeURIComponent(installId);

  const res = await fetch(url);
  const data = await res.json();

  if (data && data.success && data.active) {
    await chrome.storage.local.set({
      license_status: 'valid',
      qr_licensed_install_id: installId,
      last_verified_at: new Date().toISOString()
    });
    return true;
  }

  return false;
}

function setQrImage(approveUrl) {
  const qr = $('licenseQr');
  if (!qr) return;

  qr.src = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encodeURIComponent(approveUrl);
}

function updateQrTimer() {
  const timer = $('qrTimer');
  if (!timer) return;

  const remain = Math.max(0, qrExpireAt - Date.now());
  const sec = Math.floor(remain / 1000);
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  timer.textContent = m + ':' + s;

  if (remain <= 0) {
    createOrRefreshQrCode();
  }
}

async function createOrRefreshQrCode() {
  const installId = await getOrCreateInstallId();
  const installText = $('installIdText');
  if (installText) installText.textContent = 'Install ID：' + installId;

  setToolEnabled(false);
  showLicensePanel('正在產生授權 QR Code...');

  try {
    const res = await fetch(LICENSE_REQUEST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        install_id: installId,
        product_id: PRODUCT_ID
      })
    });

    const data = await res.json();
    if (!data || !data.success) {
      setStatus(data?.message || 'QR Code 產生失敗。');
      return;
    }

    setQrImage(data.telegram_url || data.approve_url);
    qrExpireAt = Date.now() + QR_LIFETIME_MS;
    setStatus('請管理員掃描 QR Code，並在 Telegram 輸入備註後核准。', true);

    if (!qrTimerId) {
      qrTimerId = setInterval(updateQrTimer, 1000);
    }
    updateQrTimer();

    startPollingApproval();
  } catch (e) {
    setStatus('無法產生 QR Code，請確認網路後再試。');
  }
}

function startPollingApproval() {
  if (pollTimerId) clearInterval(pollTimerId);

  pollTimerId = setInterval(async () => {
    try {
      const ok = await checkQrLicenseStatus();
      if (ok) {
        clearInterval(pollTimerId);
        pollTimerId = null;
        setToolEnabled(true);
        setStatus('授權成功，可以使用工具。', true);
        setTimeout(hideLicensePanel, 1200);
      }
    } catch (e) {
      // Keep polling; transient network errors should not interrupt the QR flow.
    }
  }, POLL_INTERVAL_MS);
}

async function loadLicenseState() {
  setToolEnabled(false);

  try {
    const ok = await checkQrLicenseStatus();
    if (ok) {
      setToolEnabled(true);
      setStatus('授權有效。', true);
      hideLicensePanel();
      return;
    }
  } catch (e) {
    const stored = await chrome.storage.local.get(['license_status', 'qr_licensed_install_id']);
    const installId = await getOrCreateInstallId();
    if (stored.license_status === 'valid' && stored.qr_licensed_install_id === installId) {
      setToolEnabled(true);
      setStatus('授權有效。', true);
      hideLicensePanel();
      return;
    }
  }

  await createOrRefreshQrCode();
}

async function send(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    alert('此分頁尚未載入工具，請確認目前在 Community.aspx 頁面。');
  }
}

async function withActiveTab(fn) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) return fn(tab.id, tab);
  alert('找不到作用中的分頁。');
}

$('refreshQrBtn').addEventListener('click', async () => {
  await createOrRefreshQrCode();
});

$('scan').addEventListener('click', () => {
  withActiveTab((tabId) => send(tabId, { type: 'YCUT_SCAN' }));
});

$('toggle').addEventListener('click', () => {
  withActiveTab((tabId) => send(tabId, { type: 'YCUT_TOGGLE_HIGHLIGHT' }));
});

document.addEventListener('DOMContentLoaded', async () => {
  await loadLicenseState();
});
