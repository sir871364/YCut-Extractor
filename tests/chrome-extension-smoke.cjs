const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const chromePath = process.env.CHROME_PATH;
const projectRoot = path.resolve(__dirname, '..');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(file, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

function readJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

function createCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
      return;
    }
    for (const listener of listeners) listener(message);
  });

  return {
    async ready() {
      if (socket.readyState === WebSocket.OPEN) return;
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
      });
    },
    send(method, params = {}, sessionId) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    onMessage(listener) { listeners.add(listener); },
    close() { socket.close(); }
  };
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  }
  return result.result.value;
}

function extensionIdForPath(extensionPath) {
  const normalizedPath = path.resolve(extensionPath).replace(/^([a-z]):/, (_, drive) => drive.toUpperCase() + ':');
  const hash = crypto.createHash('sha256').update(Buffer.from(normalizedPath, 'utf16le')).digest();
  return [...hash.subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join('');
}

async function main() {
  assert.ok(
    chromePath && fs.existsSync(chromePath),
    'Set CHROME_PATH to a Chrome for Testing or Chromium executable that supports --load-extension.'
  );
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ycut-chrome-smoke-'));
  const chrome = childProcess.spawn(chromePath, [
    '--window-position=-32000,-32000',
    '--window-size=800,600',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${projectRoot}`,
    `--load-extension=${projectRoot}`,
    'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  try {
    const portFile = path.join(profileDir, 'DevToolsActivePort');
    await waitForFile(portFile);
    const [port] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    const version = await readJson(`http://127.0.0.1:${port}/json/version`);
    const extensionId = extensionIdForPath(projectRoot);
    const cdp = createCdp(version.webSocketDebuggerUrl);
    await cdp.ready();

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    const errors = [];
    let licenseRequests = 0;

    cdp.onMessage(async (message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === 'Runtime.exceptionThrown') {
        errors.push(message.params.exceptionDetails.text || 'Uncaught exception');
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        errors.push(message.params.entry.text);
      }
      if (message.method !== 'Fetch.requestPaused') return;

      const url = message.params.request.url;
      let response;
      if (url.endsWith('/api/request-license')) {
        licenseRequests += 1;
        response = {
          success: true,
          request_id: 'chrome-smoke-request',
          telegram_url: 'https://t.me/example_bot?start=chrome_smoke_exact'
        };
      } else if (url.includes('/api/license-status')) {
        response = { success: true, active: false, reason: 'not_found' };
      } else {
        response = { success: false };
      }

      await cdp.send('Fetch.fulfillRequest', {
        requestId: message.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(response)).toString('base64')
      }, sessionId);
    });

    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: '*://ycut-license-api.sir8713642.workers.dev/*' }]
    }, sessionId);
    await cdp.send('Page.navigate', {
      url: `chrome-extension://${extensionId}/popup.html`
    }, sessionId);
    await delay(1500);

    const initial = await evaluate(cdp, sessionId, `(async () => ({
      title: document.title,
      readyState: document.readyState,
      qrSrc: document.getElementById('licenseQr')?.src || '',
      qrWidth: document.getElementById('licenseQr')?.naturalWidth || 0,
      identityAvailable: typeof chrome.identity?.getProfileUserInfo === 'function',
      storageAvailable: !!chrome.storage?.local,
      location: location.href,
      installId: chrome.storage?.local ? (await chrome.storage.local.get(['install_id'])).install_id || '' : ''
    }))()`);

    assert.equal(initial.location, `chrome-extension://${extensionId}/popup.html`);
    assert.equal(initial.storageAvailable, true, `Extension failed to load in ${version.Browser}`);
    assert.equal(initial.title, 'YCUT Blue User Scanner');
    assert.equal(initial.readyState, 'complete');
    assert.match(initial.qrSrc, /^data:image\/gif;base64,/);
    assert.ok(initial.qrWidth > 0, 'Local QR image did not render.');
    assert.equal(initial.identityAvailable, true);
    assert.ok(initial.installId);
    assert.equal(licenseRequests, 1);
    assert.deepEqual(errors, []);

    await evaluate(cdp, sessionId, `(async () => {
      await chrome.storage.local.set({
        install_id: ${JSON.stringify(initial.installId)},
        license_status: 'valid',
        qr_licensed_install_id: ${JSON.stringify(initial.installId)},
        last_verified_at: new Date().toISOString(),
        license_expires_on: '2099-12-31',
        ycut_disclaimer_accepted_v1: { accepted: true, version: 1 }
      });
    })()`);
    await cdp.send('Page.reload', {}, sessionId);
    await delay(800);

    const authorized = await evaluate(cdp, sessionId, `(async () => ({
      installId: (await chrome.storage.local.get(['install_id'])).install_id,
      scanEnabled: !document.getElementById('scan').disabled,
      status: document.getElementById('licenseStatus').textContent
    }))()`);
    assert.equal(authorized.installId, initial.installId);
    assert.equal(authorized.scanEnabled, true);
    assert.match(authorized.status, /授權/);
    assert.equal(licenseRequests, 1);
    assert.deepEqual(errors, []);
    cdp.close();

    console.log(`YCut Chrome MV3 smoke checks passed (${version.Browser}).`);
  } finally {
    chrome.kill();
    await delay(300);
    const resolvedTemp = fs.realpathSync(os.tmpdir()) + path.sep;
    const resolvedProfile = path.resolve(profileDir);
    if (!resolvedProfile.startsWith(resolvedTemp) || !path.basename(resolvedProfile).startsWith('ycut-chrome-smoke-')) {
      throw new Error(`Refusing to remove unexpected profile path: ${resolvedProfile}`);
    }
    fs.rmSync(resolvedProfile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
