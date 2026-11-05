"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "src");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("한글 입력 정책은 앱보다 먼저 로드되고 일반 입력 포커스에서만 IPC를 부른다", () => {
  const html = read("index.html");
  const policyIndex = html.indexOf('<script src="./input-language-policy.js"></script>');
  const uiIndex = html.indexOf('<script src="./input-language-ui.js"></script>');
  const appIndex = html.indexOf('<script src="./app.js"></script>');
  assert.ok(policyIndex >= 0 && policyIndex < uiIndex && uiIndex < appIndex);

  const ui = read("input-language-ui.js");
  assert.match(ui, /addEventListener\("focusin"/);
  assert.match(ui, /wantsKoreanInput\(event\.target\)/);
  assert.match(ui, /requestKoreanInput\(\)/);
});

test("한글 입력 IPC는 격리된 preload와 정식 채널 정책을 통과한다", () => {
  const preload = read("preload.js");
  const main = read("main.js");
  const mutationPolicy = read("mutation-policy.js");
  assert.match(preload, /requestKoreanInput:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("crm:input-language-korean"\)/);
  assert.match(main, /secureCanonicalHandle\("crm:input-language-korean"/);
  assert.match(main, /WindowsKoreanInput\.requestKoreanInput\(mainWindow\)/);
  assert.match(main, /mainWindow\s*=\s*new BrowserWindow\([\s\S]*?WindowsKoreanInput\.warm\(\)[\s\S]*?mainWindow\.webContents\.on\("did-start-loading"/);
  assert.match(main, /WindowsKoreanInput\.stop\(\)/);
  assert.match(mutationPolicy, /'crm:input-language-korean'/);
});
