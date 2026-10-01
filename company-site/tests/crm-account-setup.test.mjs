import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = join(TEST_DIR, "..");
const SOURCE_DIR = join(SITE_ROOT, "public", "crm-account-setup");
const EXPORTED_DIR = join(SITE_ROOT, "firebase-public", "crm-account-setup");

function loadSetupParser() {
  const source = readFileSync(join(SOURCE_DIR, "setup-core.js"), "utf8");
  const context = { URL };
  runInNewContext(source, context, { filename: "setup-core.js" });
  return context.BringCrmAccountSetup;
}

function signInLink({ continueUrl, host = "bring-fm.web.app" }) {
  const url = new URL(`https://${host}/__/auth/action`);
  url.searchParams.set("mode", "signIn");
  url.searchParams.set("oobCode", "emulator-one-time-code");
  if (continueUrl) url.searchParams.set("continueUrl", continueUrl);
  return url.href;
}

test("setup parser accepts only trusted Firebase sign-in links with opaque invite state", () => {
  const parse = loadSetupParser().parseSignInActionLink;
  const continueUrl = new URL("https://bring-fm.web.app/crm-account-setup/");
  continueUrl.searchParams.set("uid", "authUser_123");
  continueUrl.searchParams.set("invite", "A".repeat(43));

  assert.deepEqual(
    JSON.parse(JSON.stringify(parse(signInLink({ continueUrl: continueUrl.href })))),
    {
      mode: "signIn",
      actionCode: "emulator-one-time-code",
      uid: "authUser_123",
      setupToken: "A".repeat(43),
    },
  );
  assert.equal(parse(signInLink({ continueUrl: "https://attacker.example/crm-account-setup/?uid=authUser_123&invite=" + "A".repeat(43) })), null);
  const withUntrustedEmail = new URL(continueUrl.href);
  withUntrustedEmail.searchParams.set("email", "attacker@example.com");
  assert.deepEqual(
    JSON.parse(JSON.stringify(parse(signInLink({ continueUrl: withUntrustedEmail.href })))),
    {
      mode: "signIn",
      actionCode: "emulator-one-time-code",
      uid: "authUser_123",
      setupToken: "A".repeat(43),
    },
    "an email query parameter must be ignored rather than trusted",
  );
  assert.equal(parse(signInLink({ continueUrl: continueUrl.href, host: "bring-fm-hj.web.app" })), null);
});

test("invited email is displayed from the server response and never submitted as form input", () => {
  const html = readFileSync(join(SOURCE_DIR, "index.html"), "utf8");
  const script = readFileSync(join(SOURCE_DIR, "setup.js"), "utf8");
  assert.match(html, /id="setupEmail" class="setup-email-value"/u);
  assert.doesNotMatch(html, /<input[^>]+id="setupEmail"/u);
  assert.match(script, /email\.textContent\s*=\s*invite\.maskedEmail/u);
  assert.match(script, /callSetupFunction\("getCrmAccountSetupInvite"/u);
  assert.match(script, /params\.get\("link"\)\s*\|\|\s*params\.get\("deep_link_id"\)\s*\|\|\s*params\.get\("continueUrl"\)/u);
  assert.match(script, /uid:\s*inviteUid/u);
  assert.match(script, /setupToken:\s*inviteToken/u);
  assert.doesNotMatch(script, /email:\s*email\.value/u);
  assert.match(script, /history\.replaceState/u);
});

test("source and Firebase-exported setup pages stay byte-identical", () => {
  for (const filename of ["index.html", "setup.js", "setup.css", "setup-core.js"]) {
    const source = readFileSync(join(SOURCE_DIR, filename), "utf8").replaceAll("\r\n", "\n");
    const exported = readFileSync(join(EXPORTED_DIR, filename), "utf8").replaceAll("\r\n", "\n");
    const comparableSource = filename === "index.html"
      ? source.replaceAll("/crm-account-setup/", "./")
      : source;
    assert.equal(
      createHash("sha256").update(comparableSource).digest("hex"),
      createHash("sha256").update(exported).digest("hex"),
      `${filename} must match its Firebase export copy`,
    );
  }
});
