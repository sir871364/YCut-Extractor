const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const textFiles = [];

function collectTextFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    // .git 會含歷史 commit 訊息與二進位物件，不屬於產品檔案
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectTextFiles(fullPath);
    else if (!/\.(png|jpg|jpeg|gif|zip)$/i.test(entry.name)) textFiles.push(fullPath);
  }
}

collectTextFiles(root);
const forbiddenQrHost = ['api', 'qrserver', 'com'].join('.');
for (const file of textFiles) {
  assert.equal(fs.readFileSync(file, 'utf8').includes(forbiddenQrHost), false, file);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.host_permissions.some((value) => value.includes('qrserver')), false);
assert.ok(manifest.permissions.includes('identity'));
assert.ok(manifest.permissions.includes('identity.email'));

const config = fs.readFileSync(path.join(root, 'src', 'config.js'), 'utf8');
assert.match(config, /LICENSE_API_BASE_URL/);
assert.match(config, /\/api\/request-license/);
assert.match(config, /\/api\/license-status/);

const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
assert.match(popup, /createQrDataUrl\(approveUrl, 240\)/);
assert.doesNotMatch(popup, /sir8713642\.workers\.dev/);

const privacy = fs.readFileSync(path.join(root, 'privacy.md'), 'utf8');
assert.match(privacy, /generated locally inside the extension/i);
assert.match(privacy, /Google account identifier \(`google_sub`\)/);

(async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'src', 'local-qr.mjs'));
  const { createQrDataUrl } = await import(moduleUrl.href);
  const approvalUrl = 'https://example.test/approve?request_id=exact-value-123';
  const dataUrl = await createQrDataUrl(approvalUrl, 240);
  assert.match(dataUrl, /^data:image\/gif;base64,/);
  assert.ok(dataUrl.length > 100);
  console.log('YCut privacy/license checks passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
