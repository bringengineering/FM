"use strict";
const { readBoundedJson } = require("../../src/drive-oauth");
const FUNCTIONS = ["listCrmAccounts", "setCrmAccountRole", "deleteCrmAccount"];
async function checkAccountManagement(fetchImpl = fetch) {
  for (const name of FUNCTIONS) {
    const response = await fetchImpl(`https://asia-northeast3-bring-fm.cloudfunctions.net/${name}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/json" }, body: '{"data":{}}',
    });
    const body = await readBoundedJson(response, 4096);
    if (response.status !== 401 || body?.error?.status !== "UNAUTHENTICATED" || body?.error?.message !== "crm_account_setup_auth_required") throw new Error("ACCOUNT_MANAGEMENT_RELEASE_GATE_FAILED");
  }
  return true;
}
if (require.main === module) checkAccountManagement().then(() => process.stdout.write("All account management endpoints deny anonymous access.\n")).catch(() => { process.stderr.write("ACCOUNT_MANAGEMENT_RELEASE_GATE_FAILED\n"); process.exitCode=1; });
module.exports = { checkAccountManagement };
