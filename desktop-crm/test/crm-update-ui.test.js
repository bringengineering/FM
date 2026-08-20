"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");

test("rate-limited update checks wait and retry automatically instead of entering the red error state", () => {
  const retryPolicy = main.slice(main.indexOf("function rateLimitRetryAt"), main.indexOf("async function confirmApplicationExitWithPending"));
  const check = main.slice(main.indexOf("async function checkForUpdates"), main.indexOf("function authState"));

  assert.match(retryPolicy, /CRM_UPDATE_RATE_LIMITED/);
  assert.match(retryPolicy, /setTimeout\(\(\) => \{[\s\S]*?checkForUpdates\(false\)/);
  assert.match(check, /status === "waiting"[\s\S]*?retryAt[\s\S]*?Date\.now\(\)/);
  assert.match(check, /const retryAt = rateLimitRetryAt\(error\)/);
  assert.match(check, /status: "waiting"[\s\S]*?자동으로 다시 확인합니다/);
  assert.match(check, /else \{[\s\S]*?status: "error"/);
});

test("the renderer presents rate-limit waiting as a neutral disabled state", () => {
  const updateUi = app.slice(app.indexOf("function updateUpdaterUI"), app.indexOf("function cloneStore"));

  assert.match(updateUi, /status === "waiting"[\s\S]*?자동 확인 대기/);
  assert.match(updateUi, /status === "error" \? "error" : ""/);
  assert.match(updateUi, /disabled = [^;]*status === "waiting"/);
  assert.doesNotMatch(updateUi, /status === "waiting"[^\n]*업데이트 재확인/);
});
