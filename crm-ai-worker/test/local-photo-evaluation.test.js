import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseLocalKey, validateJpeg, boundedFetch, safeCode, loadDataset } from "../scripts/evaluate-local-photos.mjs";

const exampleKey = "example_test_key_not_real_12345";
const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";
const jpeg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffc00011080001000103011100021100031100ffda0008010100003f0000ffd9", "hex");
const options = () => ({ method: "POST", redirect: "manual", headers: { "x-goog-api-key": exampleKey }, body: "{}" });

test("local key parser supports user entry without exposing invalid values", () => {
  assert.equal(parseLocalKey(`# local only\nGEMINI_API_KEY=${exampleKey}\n`), exampleKey);
  assert.equal(parseLocalKey(`GEMINI_API_KEY='${exampleKey}'\r\n`), exampleKey);
  assert.equal(parseLocalKey(`GEMINI_API_KEY=AQ.${exampleKey}`), `AQ.${exampleKey}`);
  assert.equal(parseLocalKey(`GEMINI_API_KEY=AQ.${"x".repeat(250)}`), `AQ.${"x".repeat(250)}`);
  for (const value of ["", "GEMINI_API_KEY=", "GEMINI_API_KEY=secret with spaces", `GEMINI_API_KEY=${exampleKey}\nGEMINI_API_KEY=${exampleKey}`, "x".repeat(17000)]) {
    assert.throws(() => parseLocalKey(value), error => !error.message.includes(exampleKey) && ["GEMINI_NOT_CONFIGURED", "LOCAL_KEY_INVALID"].includes(error.code));
  }
  assert.equal(safeCode(new Error(exampleKey)), "LOCAL_EVALUATION_FAILED");
  assert.equal(safeCode({ code: exampleKey }), "LOCAL_EVALUATION_FAILED");
});

test("key format diagnostics describe structure without disclosing characters", () => {
  for (const [value, issue] of [[`GEMINI_API_KEY=${exampleKey}`, "duplicated_assignment"], [`${exampleKey} copied`, "embedded_whitespace"], ["hidden...value", "masked_value"], [`\"${exampleKey}`, "unmatched_quotes"], ["short", "value_too_short"], ["a".repeat(4097), "value_too_long"], [`${exampleKey}\0`, "unexpected_characters"]]) {
    assert.throws(() => parseLocalKey(`GEMINI_API_KEY=${value}`), error => error.keyFormatIssue === issue && !JSON.stringify(error).includes(exampleKey));
  }
});

test("local prepared JPEGs must be bounded, metadata-stripped and have a frame", () => {
  validateJpeg(jpeg);
  for (const value of [Buffer.alloc(130000), jpeg.subarray(0, 20), Buffer.concat([jpeg.subarray(0, 2), Buffer.from("ffe10008457869660000", "hex"), jpeg.subarray(2)]), Buffer.concat([jpeg.subarray(0, 2), Buffer.from("fffe000670696969", "hex"), jpeg.subarray(2)])]) {
    assert.throws(() => validateJpeg(value), { code: "LOCAL_IMAGE_INVALID" });
  }
  const oversizedFrame = Buffer.from(jpeg);
  oversizedFrame.writeUInt16BE(2000, 25);
  assert.throws(() => validateJpeg(oversizedFrame), { code: "LOCAL_IMAGE_INVALID" });
});

test("network wrapper has one exact destination, no redirects and a request cap", async () => {
  const audit = { apiCalls: 0, httpStatuses: [] };
  let calls = 0;
  const run = boundedFetch(async () => { calls++; return new Response("{}", { status: 200 }); }, exampleKey, audit, new AbortController().signal);
  for (const url of [endpoint + "?key=hidden", endpoint.replace("https:", "http:"), "https://127.0.0.1/", "https://example.com/"]) {
    await assert.rejects(run(url, options()), { code: "LOCAL_ENDPOINT_DENIED" });
  }
  await assert.rejects(run(endpoint, { ...options(), redirect: "follow" }), { code: "LOCAL_ENDPOINT_DENIED" });
  await assert.rejects(run(endpoint, { ...options(), body: "x".repeat(5 * 1024 * 1024 + 1) }), { code: "LOCAL_LIMIT" });
  assert.equal(calls, 0);
  await run(endpoint, options());
  assert.equal(calls, 1); assert.deepEqual(audit.httpStatuses, [200]);
  audit.apiCalls = 16;
  await assert.rejects(run(endpoint, options()), { code: "LOCAL_LIMIT" });
  assert.equal(calls, 1);
});

test("network exceptions and key-bearing errors are redacted, cancellation fails closed", async () => {
  const audit = { apiCalls: 0, httpStatuses: [] };
  const controller = new AbortController();
  const run = boundedFetch(async () => { throw new Error(exampleKey); }, exampleKey, audit, controller.signal);
  await assert.rejects(run(endpoint, options()), error => error.code === "AI_TEMPORARY_FAILURE" && !error.message.includes(exampleKey));
  controller.abort();
  await assert.rejects(run(endpoint, options()), { code: "LOCAL_LIMIT" });
  assert.equal(audit.apiCalls, 1);
});

test("provider diagnostics expose a closed category, not provider error text", async () => {
  const audit = { apiCalls: 0, httpStatuses: [] };
  const run = boundedFetch(async () => new Response(JSON.stringify({ error: { message: `Schema is too complex ${exampleKey}` } }), { status: 400 }), exampleKey, audit, new AbortController().signal);
  const result = await run(endpoint, options());
  assert.equal(result.status, 400);
  assert.equal(await result.text(), "");
  assert.deepEqual(audit.providerErrors, [{ status: 400, kind: "schema_complexity", diagnosticWords: ["schema"] }]);
  assert.equal(JSON.stringify(audit).includes(exampleKey), false);
});

test("dataset strips private references and rejects changed bytes or traversal", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bring-eval-test-"));
  try {
    fs.mkdirSync(path.join(directory, "prepared"));
    const row = { id: "test-01", kind: "common", metadataStripped: true, wholeBytes: jpeg.length, detailBytes: jpeg.length, wholeSha256: createHash("sha256").update(jpeg).digest("hex") };
    const reference = { samples: [{ id: "test-01", kind: "common", sourceFileId: "private-drive-id", localOriginal: "private-path", reviewNote: "private-note", labels: { id: "test-01", target: "window" } }] };
    fs.writeFileSync(path.join(directory, "selection-and-reference.json"), JSON.stringify(reference));
    fs.writeFileSync(path.join(directory, "prepared-manifest.json"), JSON.stringify({ samples: [row] }));
    fs.writeFileSync(path.join(directory, "prepared/test-01-whole.jpg"), jpeg);
    fs.writeFileSync(path.join(directory, "prepared/test-01-detail.jpg"), jpeg);
    const result = loadDataset(directory);
    assert.equal(result.samples.length, 1);
    assert.equal(JSON.stringify(result).includes("private-drive-id"), false);
    assert.equal(JSON.stringify(result).includes("private-note"), false);
    row.wholeSha256 = "0".repeat(64);
    fs.writeFileSync(path.join(directory, "prepared-manifest.json"), JSON.stringify({ samples: [row] }));
    assert.throws(() => loadDataset(directory), { code: "LOCAL_INPUT_INVALID" });
    row.id = "../test-01";
    fs.writeFileSync(path.join(directory, "prepared-manifest.json"), JSON.stringify({ samples: [row] }));
    assert.throws(() => loadDataset(directory), { code: "LOCAL_INPUT_INVALID" });
  } finally {
    // Only this mkdtemp test fixture, never a user-provided dataset.
    fs.rmSync(directory, { recursive: true });
  }
});
