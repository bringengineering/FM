"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const policy = fs.readFileSync(path.join(__dirname, "../src/crm-update-policy.js"), "utf8");
const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");

test("업데이트는 GitHub가 거절하는 다중 범위 요청을 쓰지 않아 바뀐 부분만 받는다", () => {
  // GitHub release storage answers multi-range requests with HTTP 501, which made
  // electron-updater fall back to downloading the whole ~96MB installer every time.
  assert.match(policy, /setFeedURL\(\{ provider: "generic", url: selected\.feedUrl, useMultipleRangeRequest: false \}\)/);
});

test("다운로드 진행률은 퍼센트가 바뀔 때만 화면에 보낸다", () => {
  const handler = main.slice(main.indexOf('autoUpdater.on("download-progress"'), main.indexOf('autoUpdater.on("update-downloaded"'));
  assert.match(handler, /updateState\.status === "downloading" && updateState\.percent === percent\) return;/);
});
