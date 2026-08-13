const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const source = file => readFile(path.join(__dirname, "..", "src", file), "utf8");

test("sidebar exposes BRING FIELD without replacing an existing CRM view", async () => {
  const html = await source("index.html");

  assert.match(
    html,
    /<button class="nav-item" data-field-platform-link><span>[^<]+<\/span><b>BRING FIELD<\/b><\/button>/,
  );
  assert.doesNotMatch(html, /data-view="fieldPlatform"/);
  assert.ok(html.indexOf('data-view="buildings"') < html.indexOf("data-field-platform-link"));
  assert.ok(html.indexOf("data-field-platform-link") < html.indexOf('data-view="consultations"'));
});

test("FIELD entry uses a dedicated fixed-url Electron IPC boundary", async () => {
  const [app, preload, main] = await Promise.all([
    source("app.js"),
    source("preload.js"),
    source("main.js"),
  ]);

  assert.match(app, /closest\("\[data-field-platform-link\]"\)/);
  assert.match(app, /await api\.openFieldPlatform\(\)/);
  assert.match(preload, /openFieldPlatform:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("crm:open-field-platform"\)/);
  assert.match(main, /const FIELD_PLATFORM_URL = "https:\/\/bring-fm\.web\.app\/field";/);
  assert.match(main, /secureHandle\("crm:open-field-platform", async \(\) =>/);
  assert.match(main, /await shell\.openExternal\(FIELD_PLATFORM_URL\)/);
});
