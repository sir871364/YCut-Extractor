const LICENSE_API = 'https://ycut-license-api.sir8713642.workers.dev/verify-license';

const $ = (id) => document.getElementById(id);

function setStatus(message, ok = false) {
  const el = $('licenseStatus');
  el.textContent = message;
  el.className = ok ? 'status ok' : 'status bad';
}

function setToolEnabled(enabled) {
  // 策略1：掃描 / 高亮屬於免費功能，永遠可用。
  $('scan').disabled = false;
  $('toggle').disabled = false;
}

function normalizeLicenseKey(value) {
  return (value || '').trim().toUpperCase();
}

function isValidLicenseKey(value) {
  return /^[A-Z2-9]{5}(-[A-Z2-9]{5}){4}$/.test(value);
}

async function getOrCreateInstallId() {
  const stored = await chrome.storage.local.get(['install_id']);
  if (stored.install_id) return stored.install_id;

  const installId = crypto.randomUUID();
  await chrome.storage.local.set({ install_id: installId });
  return installId;
}

async function verifyLicense(licenseKey) {
  const installId = await getOrCreateInstallId();
  const url = `${LICENSE_API}?license_key=${encodeURIComponent(licenseKey)}&install_id=${encodeURIComponent(installId)}`;

  const res = await fetch(url);
  return await res.json();
}

async function saveAndVerifyLicense() {
  const licenseKey = normalizeLicenseKey($('licenseKey').value);

  if (!isValidLicenseKey(licenseKey)) {
    setToolEnabled(true);
    setStatus('序號格式錯誤，格式應為 XXXXX-XXXXX-XXXXX-XXXXX-XXXXX');
    return;
  }

  setStatus('正在驗證授權...');

  try {
    const result = await verifyLicense(licenseKey);

    if (!result.success) {
      await chrome.storage.local.set({ license_status: 'invalid' });

      setToolEnabled(true);

      if (result.message === 'License revoked') {
        setStatus('授權已停用，請聯絡管理員。');
      }
      else {
        setStatus(result.message || '授權失敗');
      }

      return;
    }

    await chrome.storage.local.set({
      license_key: licenseKey,
      license_status: 'valid',
      last_verified_at: new Date().toISOString()
    });

    setToolEnabled(true);
    setStatus(result.first_bind ? '授權成功，已綁定此瀏覽器。' : '授權有效。', true);
  } catch (e) {
    setToolEnabled(true);
    setStatus('無法連線授權伺服器，請稍後再試。');
  }
}

async function loadLicenseState() {
  setToolEnabled(true);

  const stored = await chrome.storage.local.get(['license_key']);
  if (!stored.license_key) {
    setStatus('尚未啟用授權。');
    return;
  }

  $('licenseKey').value = stored.license_key;
  await saveAndVerifyLicense();
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

$('activate').addEventListener('click', saveAndVerifyLicense);

$('clearLicense').addEventListener('click', async () => {
  await chrome.storage.local.remove(['license_key', 'license_status', 'last_verified_at']);
  $('licenseKey').value = '';
  setToolEnabled(true);
  setStatus('已清除本機授權資料。');
});

$('scan').addEventListener('click', () => {
  withActiveTab((tabId) => send(tabId, { type: 'YCUT_SCAN' }));
});

$('toggle').addEventListener('click', () => {
  withActiveTab((tabId) => send(tabId, { type: 'YCUT_TOGGLE_HIGHLIGHT' }));
});

loadLicenseState();
