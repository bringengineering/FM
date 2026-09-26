const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const repoFile = file => readFile(path.join(__dirname, "..", "..", file), "utf8");
const desktopFile = file => readFile(path.join(__dirname, "..", "src", file), "utf8");

test("active public clients route to bring-fm with the intended public/private split", async () => {
  const [workflow, approval, complaint, core] = await Promise.all([
    repoFile("index.html"),
    repoFile("approve.html"),
    repoFile("apps-script/complaint-intake-to-firebase.gs"),
    desktopFile("core.js")
  ]);

  for (const source of [workflow, complaint, core]) {
    assert.match(source, /bring-fm-default-rtdb\.asia-southeast1\.firebasedatabase\.app/);
  }
  assert.match(workflow, /projectId:\s*"bring-fm"/);
  assert.match(workflow, /db\.ref\("crmCompany\/paymentCalendars\/"\+user\.uid\)/);
  assert.doesNotMatch(approval, /firebaseio|firebasedatabase|\/cases\//i);
  assert.match(approval, /기존 승인 링크는 종료되었습니다/);
  assert.match(complaint, /FIREBASE_CASES_PATH:\s*"cases"/);
  assert.match(complaint, /FIREBASE_CASE_SETTINGS_PATH:\s*"caseSettings"/);
  assert.match(complaint, /FIREBASE_PAYMENT_CALENDARS_PATH:\s*"crmCompany\/paymentCalendars"/);

  for (const source of [workflow, approval, complaint, core]) {
    assert.doesNotMatch(source, /bring-fm-hj/);
  }
});
