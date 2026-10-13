const test = require("node:test");
const assert = require("node:assert/strict");
const { checkAccountManagement } = require("../scripts/release/check-account-management");
test("management release readiness checks all three exact anonymous denials without user data", async () => {
  const urls=[];
  await checkAccountManagement(async (url, options) => {
    urls.push(url); assert.equal(options.redirect, "error"); assert.deepEqual(JSON.parse(options.body), { data: {} });
    return Response.json({ error: { status: "UNAUTHENTICATED", message: "crm_account_setup_auth_required" } }, { status: 401 });
  });
  assert.equal(urls.length, 3);
  await assert.rejects(checkAccountManagement(async () => Response.json({ result: {} }, { status: 200 })));
});
