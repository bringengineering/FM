"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, "src", file), "utf8");
const app = read("app.js");
const main = read("main.js");
const preload = read("preload.js");
const remote = read("remote.js");
const between = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));

test("explicit shared saves have a strict server-only transport", () => {
  assert.match(preload, /saveNow: data => ipcRenderer\.invoke\("crm:save-now", data\)/);
  assert.match(main, /secureHandle\("crm:save-now", data => writeStoreNow\(data\)\)/);
  assert.match(remote, /async saveStoreNow\(input\)/);
  const strict = remote.slice(remote.indexOf("async saveStoreNowLocked"), remote.indexOf("async saveStoreLocked", remote.indexOf("async saveStoreNowLocked")));
  assert.match(strict, /pushStoreLocked/);
  assert.doesNotMatch(strict, /writePendingStore/);
  assert.match(strict, /pending: false/);
});

test("customer registration confirms the server and never creates a building implicitly", () => {
  const submit = between('form.id === "customerForm"', 'form.id === "partnerVendorForm"');
  assert.match(app, /async function commitSharedFormMutation/);
  assert.match(submit, /await commitSharedFormMutation/);
  assert.doesNotMatch(submit, /commitCanonicalEntity/);
  assert.doesNotMatch(submit, /자동 생성/);
});
