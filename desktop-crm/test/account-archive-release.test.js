"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ARCHIVE_ENDPOINT, checkAccountArchive, waitForAccountArchive } = require("../scripts/release/check-account-archive");
const result = (status, code = "UNAUTHENTICATED", message = "crm_account_setup_auth_required") =>
  new Response(JSON.stringify({ error: { status: code, message } }), { status });

test("archive readiness requires the exact anonymous denial without transmitting user data", async () => {
  assert.equal(await checkAccountArchive(async (url, options) => {
    assert.equal(url, ARCHIVE_ENDPOINT);
    assert.equal(options.redirect, "error");
    assert.deepEqual(JSON.parse(options.body), { data: {} });
    assert.deepEqual(options.headers, { "content-type": "application/json" });
    return result(401);
  }), true);
  for (const response of [result(404), result(200), result(401, "OTHER"), result(401, "UNAUTHENTICATED", "other"), new Response("x".repeat(5000))]) {
    await assert.rejects(checkAccountArchive(async () => response));
  }
});

test("readiness retries are bounded and never report failure details", async () => {
  let calls = 0;
  let sleeps = 0;
  assert.equal(await waitForAccountArchive({ attempts: 2, check: async () => {
    if (++calls === 1) throw new Error("upstream detail");
  }, sleep: async ms => { assert.equal(ms, 15000); sleeps++; } }), true);
  assert.equal(sleeps, 1);
  await assert.rejects(waitForAccountArchive({ attempts: 1, check: async () => { throw new Error("private detail"); } }), /^Error: ACCOUNT_ARCHIVE_RELEASE_GATE_FAILED$/);
  await assert.rejects(waitForAccountArchive({ attempts: 31 }));
});

test("archive backend readiness gates publication after installer validation", () => {
  const yaml = fs.readFileSync(path.join(__dirname, "../../.github/workflows/crm-release.yml"), "utf8");
  const gate = yaml.indexOf("check-account-archive.js");
  assert.ok(gate > yaml.indexOf("Verify restored or newly built release assets before upload"));
  assert.ok(gate < yaml.indexOf("Deploy CRM AI Worker"));
  assert.ok(gate < yaml.indexOf("--mode publish"));
  const ci = fs.readFileSync(path.join(__dirname, "../../.github/workflows/crm-ci.yml"), "utf8");
  assert.equal((ci.match(/"release\/\*\*"/g) || []).length, 2, "both push and PR CI must validate deployment guard changes");
});
