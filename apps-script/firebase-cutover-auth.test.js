"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "complaint-intake-to-firebase.gs"), "utf8");
const approveSource = fs.readFileSync(path.join(__dirname, "..", "approve.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "appsscript.json"), "utf8"));

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Function not found: ${name}`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const current = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === "\"" || current === "'" || current === "`") {
      quote = current;
      continue;
    }
    if (current === "{") depth += 1;
    if (current === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function: ${name}`);
}

const requests = [];
const context = {
  JSON,
  String,
  Object,
  Date,
  encodeURIComponent,
  ScriptApp: {
    getOAuthToken() { return "apps-script-oauth-token"; }
  },
  UrlFetchApp: {
    fetch(url, options) {
      requests.push({ url, options });
      return {
        getResponseCode() { return 200; },
        getContentText() { return url.includes("/cases/") ? '{"id":"case-1"}' : "{}"; }
      };
    }
  },
  firebaseCaseUrl_(caseId) {
    return `https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app/cases/${caseId}.json`;
  }
};

vm.createContext(context);
vm.runInContext([
  extractFunction("readCaseFromFirebase_"),
  extractFunction("firebaseWriteRequest_"),
  extractFunction("firebaseAuthorizedWriteRequest_"),
  extractFunction("ensureOwnerDecisionShortLink_")
].join("\n\n"), context);

const read = context.readCaseFromFirebase_("case-1");
assert.equal(read.id, "case-1");
assert.equal(requests.at(-1).options.headers.Authorization, "Bearer apps-script-oauth-token");

context.firebaseWriteRequest_("https://example.test/cases/case-1.json", "patch", { ok: true }, "write failed");
assert.equal(requests.at(-1).options.headers.Authorization, "Bearer apps-script-oauth-token");

context.firebaseAuthorizedWriteRequest_(
  "https://example.test/crmCompany/paymentCalendars/uid.json?auth=user-id-token",
  "put",
  { ok: true },
  "user write failed"
);
assert.equal(requests.at(-1).url.endsWith("?auth=user-id-token"), true);
assert.equal(Object.prototype.hasOwnProperty.call(requests.at(-1).options, "headers"), false);

const linked = context.ensureOwnerDecisionShortLink_("BR-2026-1234", {
  decisionUrl: "https://script.google.com/macros/s/secure/exec?token=secret"
});
assert.equal(linked.shortDecisionUrl, linked.decisionUrl);
assert.doesNotMatch(linked.shortDecisionUrl, /approve\.html/);

assert.ok(manifest.oauthScopes.includes("https://www.googleapis.com/auth/firebase.database"));
assert.ok(manifest.oauthScopes.includes("https://www.googleapis.com/auth/userinfo.email"));
assert.doesNotMatch(approveSource, /firebaseio|firebasedatabase|\/cases\//i);
assert.match(approveSource, /기존 승인 링크는 종료되었습니다/);

console.log("firebase cutover auth tests passed");
