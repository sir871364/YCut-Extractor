const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { buildSync } = require("esbuild");

const outputFile = path.join(os.tmpdir(), `ycut-disclaimer-${process.pid}.cjs`);
buildSync({
  entryPoints: [path.join(__dirname, "..", "src", "disclaimer.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: outputFile
});

const disclaimer = require(outputFile);

async function run() {
  const key = "ycut_disclaimer_accepted_v1";
  assert.equal(disclaimer.DISCLAIMER_VERSION, 1);
  assert.equal(disclaimer.DISCLAIMER_STORAGE_KEY, key);

  let stored = {};
  global.chrome = {
    storage: {
      local: {
        async get(keys) {
          assert.deepEqual(keys, [key]);
          return stored;
        },
        async set(value) {
          stored = { ...stored, ...value };
        }
      }
    }
  };

  assert.equal(await disclaimer.getDisclaimerAccepted(), false);

  stored[key] = { accepted: true, version: 2 };
  assert.equal(await disclaimer.getDisclaimerAccepted(), false);

  stored[key] = { accepted: false, version: 1 };
  assert.equal(await disclaimer.getDisclaimerAccepted(), false);

  stored[key] = { accepted: true, version: 1 };
  assert.equal(await disclaimer.getDisclaimerAccepted(), true);

  stored = {};
  const before = Date.now();
  const record = await disclaimer.saveDisclaimerAccepted();
  const after = Date.now();
  assert.deepEqual(stored[key], record);
  assert.equal(record.accepted, true);
  assert.equal(record.version, 1);
  assert.ok(record.timestamp >= before && record.timestamp <= after);
  assert.equal(new Date(record.date).toISOString(), record.date);

  console.log("disclaimer tests passed");
}

run()
  .finally(() => fs.rmSync(outputFile, { force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
