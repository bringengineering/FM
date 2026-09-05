const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { checkContractSourceWithGateway, validateContractSourceRequest } = require("../src/contract-drive-client");

test("contract source gateway accepts only file IDs and closed admin actions", () => {
  assert.deepEqual(validateContractSourceRequest({ action: "check", driveFileId: "1K_a-safe_ID" }), { action: "check", driveFileId: "1K_a-safe_ID" });
  assert.throws(() => validateContractSourceRequest({ action: "searchByName", fileName: "계약서.docx" }), error => error.code === "INVALID_CONTRACT_SOURCE_REQUEST");
  assert.throws(() => validateContractSourceRequest({ action: "check", driveFileId: "../secret", apiKey: "x" }), error => error.code === "INVALID_CONTRACT_SOURCE_REQUEST");
});

test("contract source gateway sends Firebase identity only and bounds metadata", async () => {
  let captured;
  const result = await checkContractSourceWithGateway({
    endpoint: "https://gateway.example/v1/contracts",
    idToken: "firebase-token",
    input: { action: "check", driveFileId: "1K_a-safe_ID" },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ ok: true, requestId: "req-1", source: {
        driveFileId: "1K_a-safe_ID", title: "관리 위탁계약서.docx", revisionId: "rev-7", modifiedAt: "2026-09-02T01:02:03Z", webViewLink: "https://drive.google.com/file/d/1K_a-safe_ID/view", ignored: "drop"
      } }), { status: 200 });
    }
  });
  assert.equal(captured.options.headers.authorization, "Bearer firebase-token");
  assert.deepEqual(JSON.parse(captured.options.body), { action: "check", driveFileId: "1K_a-safe_ID" });
  assert.deepEqual(result.source, {
    driveFileId: "1K_a-safe_ID", title: "관리 위탁계약서.docx", revisionId: "rev-7", modifiedAt: "2026-09-02T01:02:03Z", webViewLink: "https://drive.google.com/file/d/1K_a-safe_ID/view"
  });
});

test("Electron exposes narrow contract IPC and keeps admin mutations in main", () => {
  const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "../src/preload.js"), "utf8");
  for (const channel of ["crm:contract-sources-load", "crm:contract-source-register", "crm:contract-source-check", "crm:contract-source-decision"]) {
    assert.match(main, new RegExp(`secureCanonicalHandle\\(\"${channel}\"`));
  }
  assert.match(main, /assertContractSourceAdmin/);
  assert.match(preload, /loadContractSources: \(\) => ipcRenderer\.invoke\("crm:contract-sources-load"\)/);
  assert.match(preload, /registerContractSource: input => ipcRenderer\.invoke\("crm:contract-source-register", input\)/);
  assert.doesNotMatch(preload, /GOOGLE_(?:DRIVE|SERVICE_ACCOUNT)|PRIVATE_KEY|refresh_token/i);
});
