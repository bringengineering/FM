"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const MutationPolicy = require("../src/mutation-policy");
const View = require("../src/telegram-server-status-view");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const app = read("app.js"), main = read("main.js"), preload = read("preload.js");

function body(source, name) {
  const start = source.indexOf("async function " + name + "(");
  assert.ok(start >= 0, name);
  const end = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("the only settings IPC is a sender-validated read-only server status check", () => {
  assert.equal(MutationPolicy.classification("crm:telegram-server-status"), "control");
  assert.ok(main.includes('secureHandle("crm:telegram-server-status"'));
  assert.ok(preload.includes('loadTelegramServerStatus: () => ipcRenderer.invoke("crm:telegram-server-status")'));
  assert.match(body(main, "loadTelegramServerStatus"), /requireTelegramAdmin\(\)/);
  assert.match(body(main, "loadTelegramServerStatus"), /return readTelegramServerStatus\(\)/);
  assert.doesNotMatch(body(main, "loadTelegramServerStatus"), /readTelegramSettings|botToken|chatId|writeFile|unlink|postToTelegram/);
  assert.match(main, /function requireTelegramAdmin\(\)[\s\S]{0,400}?user\.role !== "admin"/);
});

test("PC configuration, chat discovery and contact-send channels are removed rather than hidden", () => {
  for (const channel of ["crm:telegram-settings-load", "crm:telegram-settings-save", "crm:telegram-settings-forget", "crm:telegram-chats-find", "crm:telegram-contact-alert"]) {
    assert.equal(MutationPolicy.classification(channel), "");
    assert.ok(!main.includes('"' + channel + '"'), channel);
    assert.ok(!preload.includes('"' + channel + '"'), channel);
  }
  for (const name of ["loadTelegramSettings", "saveTelegramSettings", "forgetTelegramSettings", "findTelegramChats", "sendTelegramContactAlert", "writeTelegramSettings"]) assert.ok(!main.includes("async function " + name + "("), name);
  assert.doesNotMatch(app, /data-telegram-(form|find|pick|send|forget)|saveTelegramFromForm|sendTelegramNow|telegramChatList|telegramState\.(botToken|chatId|autoSend)/);
});

test("the renderer checks the server instead of local keys, and fails closed", () => {
  assert.match(app, /await api\.loadTelegramServerStatus\(\)/);
  assert.match(app, /telegramState\.status = "checking";\s+if \(currentView === "settings"\) renderSettings\(\);/);
  assert.match(app, /result\.connected === true && result\.status === "connected"/);
  assert.match(app, /telegramState\.status = "unavailable"/);
  assert.match(app, /Date\.now\(\) - telegramState\.checkedAt > 60000/);
  assert.doesNotMatch(app, /maybeAutoSendTelegram|telegramAutoTriedSlot/);
  assert.ok(read("index.html").includes('<script src="./telegram-server-status-view.js"></script>'));
});

test("legacy protected files are preserved without a settings read/write surface", () => {
  const reader = body(main, "readTelegramSettings");
  assert.match(reader, /decodeProtectedJson\(safeStorage/);
  assert.match(reader, /PROTECTED_DATA_REQUIRED/);
  assert.doesNotMatch(reader, /writeFile|unlink|encodeProtectedJson/);
  for (const channel of ["crm:telegram-directive-send", "crm:customer-notice-send"]) {
    assert.equal(MutationPolicy.classification(channel), "mutation");
    assert.ok(main.includes('secureCanonicalHandle("' + channel + '"'));
  }
});

test("every server status class has responsive CRM styling", () => {
  const css = read("styles.css");
  const html = View.render({ loaded: true, status: "connected" });
  const classes = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/)).filter(name => name.startsWith("tg-")));
  for (const name of classes) assert.ok(css.includes("." + name), name);
  assert.match(css, /grid-template-columns:105px minmax\(0,1fr\)/);
  assert.match(css, /@media\(max-width:520px\)/);
  assert.match(css, /\.tg-server-status\.is-unavailable/);
});
