"use strict";
const { BROKER_ENDPOINT, readBoundedJson } = require("../../src/drive-oauth");
async function checkDriveBroker(fetchImpl = fetch) {
  const response = await fetchImpl(BROKER_ENDPOINT, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "content-type": "application/json" }, body: "{}",
  });
  const body = await readBoundedJson(response, 4096);
  if (response.status !== 401 || body?.error?.code !== "DRIVE_AUTH_REQUIRED"
    || response.headers.get("x-bring-drive-ready") !== "1") {
    throw new Error("Drive broker is not configured and denying anonymous access as expected. Do not publish the desktop client.");
  }
  return true;
}
if (require.main === module) checkDriveBroker().then(() => {
  process.stdout.write("Drive broker deployed, client configuration matched, anonymous access denied.\n");
}).catch(() => { process.stderr.write("DRIVE_BROKER_RELEASE_GATE_FAILED: deploy and verify the reviewed server before publishing.\n"); process.exitCode = 1; });
module.exports = { checkDriveBroker };
