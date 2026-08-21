const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = {};
const classifierSource = fs.readFileSync(path.join(root, 'src', 'core-access.js'), 'utf8')
  .replace(/^export\s+/gm, '');
vm.runInNewContext(classifierSource, context);

const classify = context.classifyCoreLicenseStatus;
assert.equal(classify({ success: true, active: true, global_suspended: false, product_suspended: false }).decision, 'licensed');
assert.equal(classify({ success: true, active: true, global_suspended: false, product_suspended: true }).decision, 'suspended');
assert.equal(classify({ success: true, active: true, global_suspended: true, product_suspended: false }).decision, 'suspended');
assert.equal(classify({ success: true, active: false, global_suspended: false, product_suspended: false }).decision, 'unlicensed');
assert.equal(classify({ success: true, active: true }).decision, 'unavailable');

const licenseJs = fs.readFileSync(path.join(root, 'src', 'license.js'), 'utf8');
assert.match(licenseJs, /fetch\(statusUrl, \{ cache: "no-store", signal: controller\.signal \}\)/);
assert.match(licenseJs, /catch \{[\s\S]*目前無法確認授權狀態[\s\S]*return false;/);
assert.doesNotMatch(licenseJs, /requireLicenseForPremiumAction\(\)[\s\S]*await hasValidLicense\(\)/);

const contentJs = fs.readFileSync(path.join(root, 'src', 'content.js'), 'utf8');
// 3 處：擷取PDF→JSON、建立PDF資料庫、匯出失敗清單
assert.equal((contentJs.match(/await requireLicenseForPremiumAction\(\)/g) || []).length, 3);

// 開始前檢查一次不夠：長時間掃描必須能被中途停用
assert.match(licenseJs, /export function startCoreAccessWatchdog/);
for (const file of ['extractor.js', 'database-scanner.js']) {
  const source = fs.readFileSync(path.join(root, 'src', file), 'utf8');
  assert.match(source, /startCoreAccessWatchdog\(\{/, file);
  assert.match(source, /blockedByLicense/, file);
  assert.match(source, /stopWatchdog\(\)/, file);
}

console.log('YCut kill-switch checks passed.');
