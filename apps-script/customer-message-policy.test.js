"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "complaint-intake-to-firebase.gs"), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Apps Script function not found: ${name}`);
  const brace = source.indexOf("{", start); let depth = 0, quote = "", escaped = false;
  for (let i = brace; i < source.length; i += 1) { const c = source[i]; if (quote) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === quote) quote = ""; continue; } if ('"\'`'.includes(c)) { quote = c; continue; } if (c === "{") depth += 1; if (c === "}" && --depth === 0) return source.slice(start, i + 1); }
  throw new Error(`Unclosed function: ${name}`);
}

const context = { String, Object, Array, Date };
vm.createContext(context);
vm.runInContext([extractFunction("customerMessageTemplateCatalog_"), extractFunction("customerMessagePolicy_")].join("\n"), context);

let result = context.customerMessagePolicy_({ id: "c1", phone: "01012345678", messageConsents: {} }, { templateId: "building_management_offer", channel: "kakao" });
assert.equal(result.allowed, false);
assert.equal(result.code, "MARKETING_CONSENT_REQUIRED");

result = context.customerMessagePolicy_({ id: "c1", phone: "01012345678", messageConsents: { kakao: { status: "granted", consentedAt: "2026-08-01", evidenceRef: "form-1", consentTextVersion: "v1" } } }, { templateId: "building_management_offer", channel: "kakao" });
assert.equal(result.allowed, true);

result = context.customerMessagePolicy_({ id: "c1", phone: "01012345678" }, { templateId: "cleaning_schedule", channel: "kakao" });
assert.equal(result.code, "SOURCE_REQUIRED");

result = context.customerMessagePolicy_({ id: "c1", phone: "01012345678" }, { templateId: "unknown", channel: "kakao", sourceType: "work", sourceId: "w1" });
assert.equal(result.code, "TEMPLATE_NOT_ALLOWED");
console.log("PASS customer message policy fails closed");
