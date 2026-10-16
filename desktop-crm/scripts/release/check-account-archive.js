"use strict";
const { readBoundedJson } = require("../../src/drive-oauth");
const ARCHIVE_ENDPOINT = "https://asia-northeast3-bring-fm.cloudfunctions.net/archiveCrmAccountInvite";

async function checkAccountArchive(fetchImpl = fetch) {
  // Intentionally unauthenticated: readiness must never mutate an invitation.
  const response = await fetchImpl(ARCHIVE_ENDPOINT, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "content-type": "application/json" }, body: '{"data":{}}',
  });
  const body = await readBoundedJson(response, 4096);
  if (response.status !== 401 || body?.error?.status !== "UNAUTHENTICATED"
    || body?.error?.message !== "crm_account_setup_auth_required") {
    throw new Error("Account archive backend is not ready or anonymous access was not denied.");
  }
  return true;
}

async function waitForAccountArchive({ check = checkAccountArchive,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 30 } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 30) throw new Error("Invalid readiness attempts.");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { await check(); return true; }
    catch {
      if (attempt === attempts - 1) throw new Error("ACCOUNT_ARCHIVE_RELEASE_GATE_FAILED");
      await sleep(15000);
    }
  }
}

if (require.main === module) waitForAccountArchive().then(() => {
  process.stdout.write("Account archive backend deployed; anonymous access denied.\n");
}).catch(() => {
  process.stderr.write("ACCOUNT_ARCHIVE_RELEASE_GATE_FAILED: verify the reviewed backend before publishing.\n");
  process.exitCode = 1;
});
module.exports = { ARCHIVE_ENDPOINT, checkAccountArchive, waitForAccountArchive };
