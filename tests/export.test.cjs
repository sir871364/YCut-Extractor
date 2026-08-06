const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const bundlePath = path.join(os.tmpdir(), `ycut-export-${process.pid}.cjs`);
esbuild.buildSync({
  entryPoints: [path.join(process.cwd(), "src", "export.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundlePath,
  logLevel: "silent"
});

try {
  const output = require(bundlePath);
  const first = "https://docs.example.com/ycut/pdf/token-1/.pdf/";
  const second = "https://docs.example.com/ycut/pdf/token-2/.pdf/";
  assert.deepEqual(output.normalizePdfUrls([
    "",
    first,
    "not-a-pdf",
    first,
    `  ${second}  `,
    null,
    { url: first }
  ]), [first, second]);
  assert.equal(output.exportFailuresCsv([], "unused.csv"), false);
  const csv = output.buildFailuresCsv([{
    route: "八勢一街5-7",
    door: "5樓",
    etr_idx: "123",
    owner_idx: "456",
    attempts: 3,
    reason: 'timeout, "again"'
  }]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.match(csv, /^\uFEFF"路段","門牌","Etr_idx","Owner_idx","重試次數","失敗原因"\r\n/);
  assert.match(csv, /"timeout, ""again"""$/);
  console.log("export tests: PASS");
} finally {
  fs.rmSync(bundlePath, { force: true });
}
