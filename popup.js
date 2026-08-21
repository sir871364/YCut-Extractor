import {
  DISCLAIMER_STORAGE_KEY,
  DISCLAIMER_VERSION,
  getDisclaimerAccepted
} from './src/disclaimer.js';
import {
  LICENSE_REQUEST_API,
  LICENSE_STATUS_API,
  PRODUCT_ID
} from './src/config.js';
import { createQrDataUrl } from './src/local-qr.mjs';

const QR_LIFETIME_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;
const LICENSE_CACHE_TTL_MS = 30 * 60 * 1000;

const $ = (id) => document.getElementById(id);

let qrExpireAt = 0;
let qrTimerId = null;
let pollTimerId = null;
let lastLicenseCheck = null;
let licenseAuthorized = false;
let disclaimerAccepted = false;

function setStatus(message, ok = false) {
  const el = $('licenseStatus');
  if (!el) return;
  el.textContent = message;
  el.className = ok ? 'status ok' : 'status bad';
}

function setToolEnabled(enabled) {
  const canUseMainTools = enabled && licenseAuthorized && disclaimerAccepted;
  $('scan').disabled = !canUseMainTools;
  $('toggle').disabled = !canUseMainTools;
}

function stopAuthorizationUi() {
  if (pollTimerId) clearInterval(pollTimerId);
  if (qrTimerId) clearInterval(qrTimerId);
  pollTimerId = null;
  qrTimerId = null;

  const qrBox = document.querySelector('.qr-box');
  if (qrBox) qrBox.style.display = 'none';
  $('qrTimer').style.display = 'none';
  $('refreshQrBtn').style.display = 'none';
}

function showPostAuthorizationStatus(message) {
  stopAuthorizationUi();
  showLicensePanel();
  setStatus(message, true);
}

async function openDisclaimerPage() {
  const disclaimerUrl = chrome.runtime.getURL('disclaimer.html');
  const existingTabs = await chrome.tabs.query({});
  const existingTab = existingTabs.find((tab) =>
    Number.isInteger(tab.id) && tab.url === disclaimerUrl
  );

  if (existingTab) {
    await chrome.tabs.update(existingTab.id, { active: true });
    if (Number.isInteger(existingTab.windowId)) {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url: disclaimerUrl, active: true });
  }

  window.close();
}

async function applyAuthorizedPopupState() {
  licenseAuthorized = true;
  disclaimerAccepted = await getDisclaimerAccepted();
  setToolEnabled(true);

  if (!disclaimerAccepted) {
    stopAuthorizationUi();
    try {
      await openDisclaimerPage();
    } catch {
      showPostAuthorizationStatus('授權已完成，但無法開啟首次使用同意頁面。請重新開啟擴充功能後再試。');
    }
    return;
  }

  showPostAuthorizationStatus('授權與首次使用同意皆已完成。');
}

function showLicensePanel(message) {
  const panel = $('licensePanel');
  if (panel) panel.style.display = 'block';
  if (message) setStatus(message, false);
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

function setInstallIdentityText({ installId, googleEmail = '', licenseKey = '' }) {
  const installText = $('installIdText');
  if (!installText) return;

  if (googleEmail) {
    installText.textContent = 'Install ID：' + installId + '\nGoogle：' + googleEmail;
    return;
  }

  installText.textContent = (licenseKey ? 'License：' + licenseKey + '\n' : '') +
    'Install ID：' + installId;
}

async function getChromeGoogleAccount() {
  if (!chrome.identity || !chrome.identity.getProfileUserInfo) {
    return null;
  }

  return await new Promise((resolve) => {
    chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (info) => {
      if (chrome.runtime.lastError || !info || !info.id || !info.email) {
        resolve(null);
        return;
      }

      resolve({
        google_sub: info.id,
        google_email: info.email
      });
    });
  });
}

function googleAccountRequiredMessage() {
  return '請先在 Chrome 登入 Google 帳號，才能產生授權 QR Code。已授權的電腦不受影響。';
}

function taiwanDateString() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isExpiredLicenseDate(expiresOn) {
  return !/^\d{4}-\d{2}-\d{2}$/.test(String(expiresOn || '')) || taiwanDateString() > expiresOn;
}

async function hasFreshLicenseCache(installId) {
  const stored = await chrome.storage.local.get([
    'license_status',
    'qr_licensed_install_id',
    'last_verified_at',
    'license_expires_on',
    'license_key',
    'license_google_email'
  ]);

  if (stored.license_status !== 'valid' || stored.qr_licensed_install_id !== installId) {
    return false;
  }

  if (isExpiredLicenseDate(stored.license_expires_on)) {
    lastLicenseCheck = { reason: 'expired', expires_on: stored.license_expires_on || null };
    await chrome.storage.local.set({ license_status: 'invalid' });
    return false;
  }

  const verifiedAt = new Date(stored.last_verified_at || 0).getTime();
  const fresh = Number.isFinite(verifiedAt) && Date.now() - verifiedAt < LICENSE_CACHE_TTL_MS;
  if (fresh) {
    setInstallIdentityText({
      installId,
      googleEmail: stored.license_google_email || '',
      licenseKey: stored.license_key || ''
    });
  }
  return fresh;
}

async function checkQrLicenseStatus() {
  const installId = await getOrCreateInstallId();
  const url = LICENSE_STATUS_API +
    '?product_id=' + encodeURIComponent(PRODUCT_ID) +
    '&install_id=' + encodeURIComponent(installId);

  const res = await fetch(url);
  const data = await res.json();

  if (data && data.success && data.active) {
    lastLicenseCheck = data;
    await chrome.storage.local.set({
      license_status: 'valid',
      qr_licensed_install_id: installId,
      last_verified_at: new Date().toISOString(),
      license_expires_on: data.expires_on,
      license_key: data.license_key || '',
      license_google_email: data.google_email || ''
    });
    setInstallIdentityText({
      installId,
      googleEmail: data.google_email || '',
      licenseKey: data.license_key || ''
    });
    return true;
  }

  lastLicenseCheck = data;
  await chrome.storage.local.set({
    license_status: 'invalid',
    license_expires_on: data?.expires_on || null
  });
  return false;
}

async function setQrImage(approveUrl) {
  const qr = $('licenseQr');
  if (!qr) return;

  qr.src = await createQrDataUrl(approveUrl, 240);
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

async function createOrRefreshQrCode(statusMessage = '') {
  const installId = await getOrCreateInstallId();
  const googleAccount = await getChromeGoogleAccount();
  setInstallIdentityText({
    installId,
    googleEmail: googleAccount?.google_email || ''
  });

  setToolEnabled(false);
  const licenseRequestBody = {
    install_id: installId,
    product_id: PRODUCT_ID
  };

  if (googleAccount) {
    licenseRequestBody.google_sub = googleAccount.google_sub;
    licenseRequestBody.google_email = googleAccount.google_email;
    await chrome.storage.local.set({ google_account: googleAccount });
  } else {
    await chrome.storage.local.remove('google_account');
  }

  showLicensePanel('正在產生授權 QR Code...');

  try {
    const res = await fetch(LICENSE_REQUEST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(licenseRequestBody)
    });

    const data = await res.json();
    if (!data || !data.success) {
      setStatus(data?.message || 'QR Code 產生失敗。');
      return;
    }

    await setQrImage(data.telegram_url || data.approve_url);
    qrExpireAt = Date.now() + QR_LIFETIME_MS;
    setStatus(statusMessage || '請管理員掃描 QR Code，並在 Telegram 輸入備註與到期日後核准。', true);

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
        await applyAuthorizedPopupState();
      }
    } catch (e) {
      // Keep polling; transient network errors should not interrupt the QR flow.
    }
  }, POLL_INTERVAL_MS);
}

async function loadLicenseState() {
  setToolEnabled(false);
  const installId = await getOrCreateInstallId();

  if (await hasFreshLicenseCache(installId)) {
    await applyAuthorizedPopupState();
    return;
  }

  try {
    const ok = await checkQrLicenseStatus();
    if (ok) {
      await applyAuthorizedPopupState();
      return;
    }
  } catch (e) {
    if (await hasFreshLicenseCache(installId)) {
      await applyAuthorizedPopupState();
      return;
    }
  }

  const renewalMessage = lastLicenseCheck?.reason === 'expired'
    ? `授權已於 ${lastLicenseCheck.expires_on || '設定期限'} 到期，請重新掃描 QR Code 授權。`
    : '';
  await createOrRefreshQrCode(renewalMessage);
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
  if (!licenseAuthorized || !disclaimerAccepted) return;
  withActiveTab((tabId) => send(tabId, { type: 'YCUT_SCAN' }));
});

$('toggle').addEventListener('click', () => {
  if (!licenseAuthorized || !disclaimerAccepted) return;
  withActiveTab((tabId) => send(tabId, { type: 'YCUT_TOGGLE_HIGHLIGHT' }));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !licenseAuthorized) return;
  const record = changes[DISCLAIMER_STORAGE_KEY]?.newValue;
  if (record?.accepted !== true || record?.version !== DISCLAIMER_VERSION) return;
  disclaimerAccepted = true;
  setToolEnabled(true);
  showPostAuthorizationStatus('授權與首次使用同意皆已完成。');
});

document.addEventListener('DOMContentLoaded', async () => {
  await loadLicenseState();
});
