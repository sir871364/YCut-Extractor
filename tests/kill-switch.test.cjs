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

// ---- 帳號綁定政策（伺服器下達、擴充先行部署）----
// 最重要：伺服器沒送 account_policy 時必須全部 optional，否則一部署就有人被誤擋。
// vm 跑在另一個 realm，回傳物件的原型不是本 realm 的 Object.prototype，
// assert/strict 的 deepEqual 會判「結構相同但不相等」。攤平成本 realm 的物件再比。
const readPolicy = (d) => ({ ...context.readAccountPolicy(d) });
assert.deepEqual(readPolicy({}), { trial: 'optional', license: 'optional' });
assert.deepEqual(readPolicy(null), { trial: 'optional', license: 'optional' });
assert.deepEqual(readPolicy({ account_policy: { license: 'REQUIRED' } }), { trial: 'optional', license: 'optional' });
assert.deepEqual(readPolicy({ account_policy: { license: 'required' } }), { trial: 'optional', license: 'required' });

// 閘門與看門狗共用 fetchCoreAccessDecision，政策接在那裡就同時涵蓋兩者
{
  const fn = licenseJs.slice(licenseJs.indexOf('export async function fetchCoreAccessDecision'),
    licenseJs.indexOf('export function startCoreAccessWatchdog'));
  // 緊急停止優先於政策
  assert.ok(fn.indexOf('status.decision === "suspended"') < fn.indexOf('readAccountPolicy(result)'));
  assert.match(fn, /policy\.license === "required" && !\(await getBrowserAccount\(\)\)/);
  assert.match(fn, /decision: "account_required"/);
}
assert.match(licenseJs, /requireLicenseForPremiumAction[\s\S]{0,400}?status\.decision === "account_required"/);
// content script 拿不到 identity，必須由 background 代查
const backgroundJs = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
assert.match(backgroundJs, /YCUT_GET_ACCOUNT/);
assert.match(backgroundJs, /getProfileUserInfo\(\{ accountStatus: 'ANY' \}/);
// popup 申請 QR 也看政策
const popupJs = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
assert.match(popupJs, /lastAccountPolicy = readAccountPolicy\(data\)/);
assert.match(popupJs, /lastAccountPolicy\.license === 'required' && !googleAccount/);

console.log('YCut kill-switch checks passed.');
