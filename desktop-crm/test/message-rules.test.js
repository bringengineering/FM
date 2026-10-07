const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8")).rules;

test("message deliveries are readable by active CRM users and client writes are denied", () => {
  const node = rules.crmCompany.messageDeliveries;
  assert.match(node[".read"], /role/);
  assert.equal(node[".write"], false);
});

test("customer message consent has a closed channel schema", () => {
  const node = rules.crmCompany.data.customers.$customerId.messageConsents;
  assert.equal(node.$other[".validate"], false);
  for (const channel of ["kakao", "sms"]) {
    assert.match(node[channel][".validate"], /consentTextVersion/);
    assert.match(node[channel][".validate"], /evidenceRef/);
  }
});
