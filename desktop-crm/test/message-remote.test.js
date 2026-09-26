const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const remote = fs.readFileSync(path.join(__dirname, "../src/remote.js"), "utf8");
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");

test("remote allows closed customer message actions and loads delivery history", () => {
  assert.match(remote, /"sendCustomerMessage", "getCustomerMessageDeliveryStatus"/);
  assert.match(remote, /dbRequest\("messageDeliveries"/);
  assert.match(remote, /MESSAGE_REQUEST_ID_REQUIRED/);
});

test("local mode simulates a sanitized customer message delivery", () => {
  assert.match(main, /source\.action === "sendCustomerMessage"/);
  assert.match(main, /messageDeliveries/);
  assert.doesNotMatch(main, /messageDeliveries[^\n]+phone:/);
});
