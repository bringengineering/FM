const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { main } = require("../scripts/release/check-drive-oauth-client");

const BRING_FM_CLIENT_ID = "864976295990-bringcrm.apps.googleusercontent.com";
const RETIRED_PROJECT_CLIENT_ID = "975975605634-bringcrm.apps.googleusercontent.com";

test("release accepts a valid public Desktop OAuth client ID without printing it", () => {
  const original = process.stdout.write;
  let output = "";
  process.stdout.write = value => { output += String(value); return true; };
  try {
    assert.deepEqual(main(["--client-id", BRING_FM_CLIENT_ID]), { configured: true });
  } finally {
    process.stdout.write = original;
  }
  assert.doesNotMatch(output, /864976295990/u);
});

test("release refuses to build without a valid Desktop OAuth client ID", () => {
  assert.throws(() => main(["--client-id", "not-a-client"]), error => error && error.code === "CRM_DRIVE_OAUTH_CLIENT_INVALID");
});

test("release rejects a valid Google client ID from bring-fm-hj or any other project", () => {
  assert.throws(
    () => main(["--client-id", RETIRED_PROJECT_CLIENT_ID]),
    error => error && error.code === "CRM_DRIVE_OAUTH_PROJECT_MISMATCH",
  );
});

test("release workflow injects the validated client ID into packaged metadata", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../../.github/workflows/crm-release.yml"), "utf8");
  assert.match(workflow, /check-drive-oauth-client\.js/u);
  assert.match(workflow, /Require the BRING-FM Google Drive Desktop OAuth client ID/u);
  assert.match(workflow, /extraMetadata\.driveOAuthClientId/u);
  assert.match(workflow, /vars\.BRING_CRM_GOOGLE_DRIVE_CLIENT_ID/u);
});
