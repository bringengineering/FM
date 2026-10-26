const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
test("the existing release workflow ensures management only after the installer and before Worker/publication", () => {
  const yaml=fs.readFileSync(path.join(__dirname,"../../.github/workflows/crm-release.yml"),"utf8");
  const backend=yaml.slice(yaml.indexOf("  ensure-account-management:"),yaml.indexOf("  deploy-cleaning-report:"));
  assert.match(backend,/needs: \[plan, reserve-build\]/);
  assert.match(backend,/crm-account-management-deployment\.cjs --apply/);
  assert.match(backend,/steps\.management\.outputs\.ready != 'true'/);
  const worker=yaml.slice(yaml.indexOf("  deploy-ai-worker:"),yaml.indexOf("  stage-release:"));
  assert.match(worker,/needs: \[plan, reserve-build, ensure-account-management, deploy-cleaning-report\]/);
});
