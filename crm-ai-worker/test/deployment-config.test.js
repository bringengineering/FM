import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("Cloudflare compatibility date is deployable in current UTC", () => {
  const config = fs.readFileSync(path.join(__dirname, "..", "wrangler.toml"), "utf8");
  const match = config.match(/^compatibility_date\s*=\s*"(\d{4}-\d{2}-\d{2})"/m);
  assert.ok(match, "wrangler.toml must declare compatibility_date");
  assert.ok(match[1] <= new Date().toISOString().slice(0, 10), `${match[1]} is later than Cloudflare UTC`);
});

test("Cloudflare production deployment disables temporary preview URLs", () => {
  const config = fs.readFileSync(path.join(__dirname, "..", "wrangler.toml"), "utf8");
  assert.match(config, /^preview_urls\s*=\s*false$/m);
});
