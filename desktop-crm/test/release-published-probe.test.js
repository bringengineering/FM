"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { probePublishedRelease } = require("../scripts/release/probe-published-release");

const SHA512 = Buffer.alloc(64, 9).toString("base64");

function response({ ok = true, status = 200, text = "", length = "" } = {}) {
  return {
    ok,
    status,
    headers: { get(name) { return String(name).toLowerCase() === "content-length" ? length : null; } },
    async text() { return text; },
  };
}

function manifest(version, size) {
  const installer = `BRING.CRM.Company.Setup.${version}.exe`;
  return [
    `version: ${version}`,
    "files:",
    `  - url: ${installer}`,
    `    sha512: ${SHA512}`,
    `    size: ${size}`,
    `path: ${installer}`,
    `sha512: ${SHA512}`,
    "releaseDate: '2026-08-20T01:29:12.000Z'",
    "",
  ].join("\n");
}

test("probes the tag-specific public manifest, installer, and blockmap before channel publication", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options.method]);
    if (url.endsWith("/latest.yml")) return response({ text: manifest("1.8.8", 12345) });
    if (url.endsWith(".exe")) return response({ length: "12345" });
    if (url.endsWith(".exe.blockmap")) return response({ length: "456" });
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await probePublishedRelease({ version: "1.8.8", attempts: 1, fetchImpl });
  assert.equal(result.tag, "crm-v1.8.8");
  assert.equal(result.attempt, "1");
  assert.deepEqual(calls.map(call => call[1]), ["GET", "HEAD", "HEAD"]);
  assert.ok(calls.every(call => call[0].includes("/releases/download/crm-v1.8.8/")));
});

test("fails closed when the public installer size does not match latest.yml", async () => {
  const fetchImpl = async url => {
    if (url.endsWith("/latest.yml")) return response({ text: manifest("1.8.8", 12345) });
    return response({ length: url.endsWith(".exe") ? "12344" : "456" });
  };
  await assert.rejects(
    probePublishedRelease({ version: "1.8.8", attempts: 1, fetchImpl }),
    error => error.code === "CRM_RELEASE_PUBLIC_PROBE_FAILED"
  );
});

test("retries boundedly without mutating any release or ref", async () => {
  let requests = 0;
  let sleeps = 0;
  await assert.rejects(
    probePublishedRelease({
      version: "1.8.8",
      attempts: 3,
      fetchImpl: async () => { requests += 1; return response({ ok: false, status: 404 }); },
      sleepImpl: async () => { sleeps += 1; },
    }),
    error => error.code === "CRM_RELEASE_PUBLIC_PROBE_FAILED"
  );
  assert.equal(requests, 3);
  assert.equal(sleeps, 2);
});
