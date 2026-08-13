const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");
const test = require("node:test");

test("CRM exposes BRING FIELD without changing its Firebase project", async () => {
  const html = await readFile(join(__dirname, "..", "index.html"), "utf8");

  assert.match(html, /projectId:\s*"bring-fm-hj"/);
  assert.match(
    html,
    /<a\s+class="btn"\s+href="https:\/\/bring-fm\.web\.app\/field"\s+target="_blank"\s+rel="noopener">📷 BRING FIELD<\/a>/,
  );
});
