const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..", "..");
const livePath = path.join(repoRoot, "signage", "admin.html");
const templatePath = path.join(repoRoot, "signage-template", "admin.html");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("signage admin and deployment template remain identical", () => {
  assert.equal(read(livePath), read(templatePath));
});

for (const [label, filePath] of [["live", livePath], ["template", templatePath]]) {
  test(`${label} signage admin uses Firebase Google auth instead of a shared password`, () => {
    const html = read(filePath);

    assert.doesNotMatch(html, /ADMIN_PASS|GATE_KEY|sessionStorage|getElementById\(["']pass["']\)|id=["']pass(?:Btn)?["']/);
    assert.match(html, /firebase-auth-compat\.js/);
    assert.match(html, /new firebase\.auth\.GoogleAuthProvider\(\)/);
    assert.match(html, /auth\.signInWithPopup\(provider\)/);
    assert.match(html, /auth\.signOut\(\)/);
  });

  test(`${label} signage admin verifies the exact CRM access grant before subscribing`, () => {
    const html = read(filePath);

    assert.match(html, /db\.ref\(`crmCompany\/access\/\$\{user\.uid\}`\)\.once\("value"\)/);
    assert.match(html, /access\.enabled === true/);
    assert.match(html, /access\.email === user\.email/);
    assert.match(html, /new Set\(\["admin", "member"\]\)/);
    assert.match(html, /auth\.currentUser\.uid !== authorizedUid/);

    const grantIndex = html.indexOf("authorizedUid=user.uid");
    const unlockIndex = html.indexOf("unlock(user)", grantIndex);
    const subscribeIndex = html.indexOf("subscribeProducts()", unlockIndex);
    assert.ok(grantIndex >= 0 && unlockIndex > grantIndex && subscribeIndex > unlockIndex);
  });
}
