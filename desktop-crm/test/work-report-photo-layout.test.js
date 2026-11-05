const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = name => fs.readFileSync(path.join(__dirname, "..", "src", name), "utf8");

test("work report photo section does not reuse the individual photo card grid class", () => {
  const appSource = src("app.js");
  const styleSource = src("styles.css");

  assert.match(appSource, /<section class="wr-ai-card wr-ai-photo-section">/);
  assert.doesNotMatch(appSource, /<section class="wr-ai-card wr-ai-photo-card">/);
  assert.match(styleSource, /\.wr-ai-photo-section \.wr-drive\s*\{/);
  assert.match(styleSource, /\.wr-ai-photo-card\s*\{[^}]*grid-template-columns:\s*76px minmax\(0,1fr\)/);
});

test("classified photo list stays compact and scrolls internally", () => {
  const styleSource = src("styles.css");
  const rule = styleSource.match(/\.wr-ai-photo-review>div\s*\{([^}]*)\}/);

  assert.ok(rule, "photo review grid rule should exist");
  assert.match(rule[1], /max-height:\s*180px/);
  assert.match(rule[1], /overflow-y:\s*auto/);
  assert.match(rule[1], /overscroll-behavior:\s*contain/);
  assert.match(rule[1], /scrollbar-gutter:\s*stable/);
});
