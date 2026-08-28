const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function resolveSourceRoot() {
  const requestedRoot = String(process.env.BRING_CRM_CONTRACT_ROOT || "").trim();
  if (!requestedRoot) return path.join(__dirname, "../src");
  const absoluteRoot = path.resolve(requestedRoot);
  return fs.existsSync(path.join(absoluteRoot, "src", "index.html"))
    ? path.join(absoluteRoot, "src")
    : absoluteRoot;
}

const sourceRoot = resolveSourceRoot();
const html = fs.readFileSync(path.join(sourceRoot, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(sourceRoot, "app.js"), "utf8");
const copy = {
  allowed: "\uD5C8\uC6A9\uB41C",
  registered: "\uB4F1\uB85D\uB41C",
  registeredByCompany: "\uB4F1\uB85D\uD55C",
  email: "\uC774\uBA54\uC77C",
  password: "\uBE44\uBC00\uBC88\uD638",
  google: "\uAD6C\uAE00"
};

function hasManagedEmailCopy(value) {
  return [copy.allowed, copy.registered, copy.registeredByCompany].some(label => value.includes(label));
}

function openingTagById(source, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`<[^>]+\\bid=["']${escapedId}["'][^>]*>`, "i"));
  assert.ok(match, `${id} element must exist in ${sourceRoot}`);
  return match[0];
}

function functionBody(source, declaration) {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} must exist in ${sourceRoot}`);
  const brace = source.indexOf("{", start);
  assert.notEqual(brace, -1, `${declaration} must have a body`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(brace + 1, index);
    }
  }
  assert.fail(`${declaration} body is not balanced`);
}

test("login email is empty, editable, and clearable", () => {
  const emailTag = openingTagById(html, "loginEmail");
  assert.doesNotMatch(emailTag, /\b(?:readonly|disabled)\b/i);
  const preset = emailTag.match(/\bvalue\s*=\s*["']([^"']*)["']/i);
  assert.equal(preset ? preset[1] : "", "", "login email must not ship with a preset account");
  assert.doesNotMatch(html, /dpvld858@gmail\.com/i);
  assert.doesNotMatch(appSource, /dpvld858@gmail\.com/i);
  assert.doesNotMatch(appSource, /loginEmail\.readOnly\s*=\s*true/);
  assert.doesNotMatch(appSource, /loginEmail\.setAttribute\(\s*["']readonly["']/i);
});

test("login copy consistently describes allowed email and password login", () => {
  const description = html.match(/<p\b[^>]*\bid=["']loginDescription["'][^>]*>([\s\S]*?)<\/p>/i);
  assert.ok(description, "login description must exist");
  const visibleDescription = description[1].replace(/<[^>]+>/g, " ");
  assert.ok(hasManagedEmailCopy(visibleDescription));
  assert.ok(visibleDescription.includes(copy.email));
  assert.ok(visibleDescription.includes(copy.password));
  assert.doesNotMatch(visibleDescription, /Google/i);
  assert.equal(visibleDescription.includes(copy.google), false);
  assert.doesNotMatch(appSource, /Google\s*\uACC4\uC815\uC73C\uB85C\s*\uB85C\uADF8\uC778/i);

  const showLogin = functionBody(appSource, "function showLogin");
  assert.match(showLogin, /loginDescription\.(?:innerHTML|textContent)\s*=/);
  assert.ok(hasManagedEmailCopy(showLogin));
  assert.ok(showLogin.includes(copy.email));
  assert.ok(showLogin.includes(copy.password));
  assert.doesNotMatch(showLogin, /["'`][^"'`]*Google[^"'`]*["'`]/i);
  assert.equal(showLogin.includes(copy.google), false);
});

test("login shows the initial password and directs users to change it", () => {
  const temporaryPassword = html.match(/<div\b[^>]*\bclass=["']temporary-password["'][^>]*>([\s\S]*?)<\/div>/i);
  assert.ok(temporaryPassword, "temporary password guidance must be visible on the login form");
  const visibleCopy = temporaryPassword[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.match(visibleCopy, /최초 비밀번호\s+1234/);
  assert.match(visibleCopy, /로그인 후 새 비밀번호로 변경/);
});

test("email form submits the account typed by the user", () => {
  const submitHandler = functionBody(appSource, 'loginForm.addEventListener("submit"');
  assert.match(
    submitHandler,
    /api\.login\s*\(\s*\{\s*email\s*:\s*loginEmail\.value\.trim\(\)\s*,\s*password\s*:\s*loginPassword\.value\s*\}\s*\)/
  );
  assert.doesNotMatch(submitHandler, /email\s*:\s*["'][^"']+@[^"']+["']/i);
});

test("failed login restores editable controls without erasing the email", () => {
  const showLogin = functionBody(appSource, "function showLogin");
  assert.match(showLogin, /loginButton\.disabled\s*=\s*false/);
  assert.doesNotMatch(showLogin, /loginEmail\.value\s*=/);

  const submitHandler = functionBody(appSource, 'loginForm.addEventListener("submit"');
  for (const control of ["loginEmail", "loginPassword"]) {
    const locksControl = new RegExp(`${control}\\.(?:disabled|readOnly)\\s*=\\s*true`).test(submitHandler);
    const restoresInLogin = new RegExp(`${control}\\.(?:disabled|readOnly)\\s*=\\s*false`).test(showLogin);
    const restoresInFinally = new RegExp(`finally\\s*\\{[\\s\\S]*?${control}\\.(?:disabled|readOnly)\\s*=\\s*false`).test(submitHandler);
    assert.ok(!locksControl || restoresInLogin || restoresInFinally, `${control} must be usable after a failed login`);
  }
  assert.match(submitHandler, /if\s*\(\s*!result\.ok\s*\)[\s\S]*?showLogin\s*\(/);
  assert.match(submitHandler, /catch\s*\([^)]*\)\s*\{[\s\S]*?showLogin\s*\(/);
  assert.match(submitHandler, /finally\s*\{[\s\S]*?loginInProgress\s*=\s*false[\s\S]*?loginButton\.disabled\s*=\s*false/);
});
