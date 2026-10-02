const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { checkDriveBroker } = require("../scripts/release/check-drive-broker");
test("publication requires matching deployed broker which denies anonymous requests", async () => {
  const result = (status, code, ready) => new Response(JSON.stringify({ error: { code } }), { status, headers: { "x-bring-drive-ready": ready } });
  assert.equal(await checkDriveBroker(async () => result(401, "DRIVE_AUTH_REQUIRED", "1")), true);
  for (const response of [result(404, "missing", "0"), result(401, "DRIVE_AUTH_REQUIRED", "0"), result(200, "", "1")]) {
    await assert.rejects(checkDriveBroker(async () => response));
  }
});
test("release gate precedes worker and stable publication without deploying any server", () => {
  const yaml = fs.readFileSync(path.join(__dirname, "../../.github/workflows/crm-release.yml"), "utf8");
  const gate = yaml.indexOf("check-drive-broker.js");
  assert.ok(gate > yaml.indexOf("Verify restored or newly built release assets before upload"));
  assert.ok(gate < yaml.indexOf("Deploy CRM AI Worker"));
  assert.ok(gate < yaml.indexOf("--mode publish"));
});
