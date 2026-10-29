const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");

test("preload exposes only narrow document delivery operations", () => {
  const preload = read("preload.js");
  const main = read("main.js");
  for (const method of ["readDocumentDeliveryCapabilities", "createDocumentDeliveryLink", "sendCustomerDocument", "readCustomerDocumentDelivery", "revokeCustomerDocument"]) assert.match(preload, new RegExp(`${method}:`));
  for (const channel of ["crm:document-delivery-capabilities", "crm:document-delivery-create", "crm:document-delivery-send", "crm:document-delivery-status", "crm:document-delivery-revoke"]) assert.match(main, new RegExp(channel));
  assert.doesNotMatch(preload, /GROQ_API_KEY|KAKAO_API_KEY|SMS_API_KEY|workers\.dev/);
});
