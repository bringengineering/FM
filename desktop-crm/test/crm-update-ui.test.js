"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");

test("temporary update failures wait and retry automatically instead of entering the red error state", () => {
  const retryPolicy = main.slice(main.indexOf("function nestedUpdateErrorCodes"), main.indexOf("async function confirmApplicationExitWithPending"));
  const check = main.slice(main.indexOf("async function checkForUpdates"), main.indexOf("function authState"));

  assert.match(retryPolicy, /CRM_UPDATE_RATE_LIMITED/);
  assert.match(retryPolicy, /setTimeout\(\(\) => \{[\s\S]*?checkForUpdates\(false\)/);
  assert.match(retryPolicy, /const delays = \[15_000, 60_000, 5 \* 60_000\]/);
  assert.match(retryPolicy, /CRM_UPDATE_POINTER_INVALID[\s\S]*?CRM_UPDATE_MANIFEST_MISMATCH/);
  assert.match(retryPolicy, /status: "waiting"[\s\S]*?자동으로 업데이트를 재시도합니다/);
  assert.match(retryPolicy, /status: "error"[\s\S]*?안전성 검증/);
  assert.match(check, /!manual && updateState\.status === "waiting"[\s\S]*?retryAt[\s\S]*?Date\.now\(\)/);
  assert.match(check, /recoverUpdateError\(error\)/);
});

test("desktop update checks use Electron networking so transferred PCs honor Windows proxy settings", () => {
  const check = main.slice(main.indexOf("async function checkForUpdates"), main.indexOf("function authState"));

  assert.match(main.split("\n", 1)[0], /\bnet\b/);
  assert.match(check, /fetchImpl:\s*\(url, options\) => net\.fetch\(url, options\)/);
  assert.doesNotMatch(check, /checkCrmUpdates\(\{ updater: autoUpdater \}\)/);
});

test("the renderer presents rate-limit waiting as a neutral disabled state", () => {
  const updateUi = app.slice(app.indexOf("function updateUpdaterUI"), app.indexOf("function cloneStore"));

  assert.match(updateUi, /status === "waiting"[\s\S]*?자동 확인 대기/);
  assert.match(updateUi, /status === "error" \? "error" : ""/);
  assert.match(updateUi, /disabled = [^;]*status === "waiting"/);
  assert.doesNotMatch(updateUi, /status === "waiting"[^\n]*업데이트 재확인/);
});
