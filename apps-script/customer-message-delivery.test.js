"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "complaint-intake-to-firebase.gs"), "utf8");

assert.match(source, /function handleCustomerMessageSend_\(payload\)/);
assert.match(source, /function handleCustomerMessageDeliveryStatus_\(payload\)/);
assert.match(source, /function customerMessageSourceMatches_\(customer, sourceRecord\)/);
assert.match(source, /MARKETING_CONSENT_REQUIRED/);
assert.match(source, /allowSmsFallback: false/);
assert.match(source, /phoneMasked: maskPhone_\(phone\)/);
assert.match(source, /firebaseWriteRequest_\(recordUrl, "put", record/);
assert.doesNotMatch(source, /record\.phone\s*=/);
assert.doesNotMatch(source, /record\.content\s*=/);
assert.match(source, /existing\.requestHash !== requestHash/);
console.log("PASS customer message delivery handler security contract");
