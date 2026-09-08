const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "../..");

function textFiles(root) {
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...textFiles(target));
    else if (/\.(?:js|json|toml|html|css)$/i.test(entry.name)) results.push(target);
  }
  return results;
}

test("CRM application and AI gateway package inputs contain no Groq credential values", () => {
  const roots = [
    path.join(repositoryRoot, "desktop-crm/src"),
    path.join(repositoryRoot, "desktop-crm/package.json"),
    path.join(repositoryRoot, "crm-ai-worker/src"),
    path.join(repositoryRoot, "crm-ai-worker/wrangler.toml"),
    path.join(repositoryRoot, "crm-ai-worker/package.json")
  ];
  const files = roots.flatMap(target => fs.statSync(target).isDirectory() ? textFiles(target) : [target]);
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\bgsk_[A-Za-z0-9_-]{10,}\b/, `${path.relative(repositoryRoot, file)} contains a Groq key-shaped value`);
    assert.doesNotMatch(source, /GROQ_API_KEY\s*=\s*["'][^"']+["']/, `${path.relative(repositoryRoot, file)} assigns a Groq secret`);
  }
});

test("renderer and preload never reference the Groq secret or provider authorization", () => {
  for (const relative of ["desktop-crm/src/app.js", "desktop-crm/src/index.html", "desktop-crm/src/preload.js"]) {
    const source = fs.readFileSync(path.join(repositoryRoot, relative), "utf8");
    assert.doesNotMatch(source, /GROQ_API_KEY|gsk_|api\.groq\.com|Bearer\s+\$\{?env\.GROQ_API_KEY/);
  }
});

test("main process targets the deployed company AI gateway", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "desktop-crm/src/main.js"), "utf8");
  assert.match(source, /https:\/\/bring-crm-ai-gateway\.bringengineering1008\.workers\.dev\/v1\/assist/);
});
