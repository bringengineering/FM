"use strict";

const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

test("the initial server placeholder cannot overwrite the authoritative load status", async () => {
  const app = await readFile(path.join(__dirname, "..", "src", "app.js"), "utf8");
  const init = app.slice(app.indexOf("async function init()"), app.indexOf("window.__crmTest"));
  const placeholder = 'updateSyncUI(currentAuth.required ? { status: "syncing", message: "공용 서버 연결 확인 중" }';
  const placeholderIndex = init.indexOf(placeholder);
  const loadIndex = init.indexOf("await loadApplication()");

  assert.ok(placeholderIndex >= 0, "the renderer should show a bounded initial placeholder");
  assert.ok(loadIndex >= 0, "the renderer should load the authoritative remote store");
  assert.ok(placeholderIndex < loadIndex, "the placeholder must be set before remote sync events can arrive");
  assert.equal(init.indexOf(placeholder, placeholderIndex + 1), -1, "the placeholder must not be restored after loading");
  assert.ok(app.indexOf("api.onSyncState") < app.indexOf("async function init()"), "the sync listener must be active before initialization");
});
