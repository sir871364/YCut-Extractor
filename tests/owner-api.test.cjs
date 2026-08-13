const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const bundlePath = path.join(os.tmpdir(), `ycut-owner-api-${process.pid}.cjs`);
esbuild.buildSync({
  entryPoints: [path.join(process.cwd(), "src", "owner-api.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundlePath,
  logLevel: "silent"
});

async function run() {
  const api = require(bundlePath);

  assert.equal(api.parseTranscriptDate("2026/01/17"), Date.UTC(2026, 0, 17));
  assert.equal(api.parseTranscriptDate("民國 115年1月17日"), Date.UTC(2026, 0, 17));
  assert.equal(api.parseTranscriptDate("無日期"), null);

  const selected = api.selectLatestDetail([
    { RegPrintDate: "2023/12/12", PDF: "old" },
    { RegPrintDate: "2026/01/17", PDF: "new" },
    { RegPrintDate: "bad", PDF: "fallback" }
  ]);
  assert.equal(selected.detail.PDF, "new");
  assert.equal(selected.usedDateFallback, false);

  const fallback = api.selectLatestDetail([
    { RegPrintDate: "bad", PDF: "first" },
    { RegPrintDate: "also bad", PDF: "second" }
  ]);
  assert.equal(fallback.detail.PDF, "first");
  assert.equal(fallback.usedDateFallback, true);

  const latestParams = api.selectLatestOwnerParams([
    { etrIdx: "old", ownerIdx: "1", displayedDateValue: Date.UTC(2024, 0, 1) },
    { etrIdx: "new", ownerIdx: "2", displayedDateValue: Date.UTC(2026, 0, 1) }
  ]);
  assert.equal(latestParams.params.etrIdx, "new");
  assert.equal(latestParams.usedDateFallback, false);

  let calls = 0;
  let retries = 0;
  global.fetch = async () => {
    calls++;
    if (calls < 3) throw new Error("temporary");
    return {
      ok: true,
      json: async () => ({ Status: "1", Data: [{ RegPrintDate: "2026/01/17" }] })
    };
  };
  const retried = await api.requestOwnerDetailsWithRetry(
    { etrIdx: "1", ownerIdx: "2" },
    { retryDelays: [1, 1], timeoutMs: 100, onRetry: () => retries++ }
  );
  assert.equal(calls, 3);
  assert.equal(retries, 2);
  assert.equal(retried.attempts, 3);
  assert.equal(retried.details.length, 1);

  calls = 0;
  global.fetch = async () => {
    calls++;
    throw new Error("permanent");
  };
  await assert.rejects(
    api.requestOwnerDetailsWithRetry(
      { etrIdx: "1", ownerIdx: "2" },
      { retryDelays: [1, 1], timeoutMs: 100 }
    ),
    (error) => error.message === "permanent" && error.attempts === 3
  );
  assert.equal(calls, 3);

  console.log("owner-api tests: PASS");
}

run()
  .finally(() => fs.rmSync(bundlePath, { force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
