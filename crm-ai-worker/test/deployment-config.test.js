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

test("production gateway is enabled only through the reviewed deployment config", () => {
  const config = fs.readFileSync(path.join(__dirname, "..", "wrangler.toml"), "utf8");
  assert.match(config, /^AI_ENABLED\s*=\s*"true"$/m);
});

test("document delivery has dedicated storage and stays closed before Kakao approval", () => {
  const config = fs.readFileSync(path.join(__dirname, "..", "wrangler.toml"), "utf8");
  assert.match(config, /^DOCUMENT_DELIVERY_ENABLED\s*=\s*"false"$/m);
  assert.match(config, /^KAKAO_DOCUMENT_TEMPLATES_APPROVED\s*=\s*"false"$/m);
  assert.match(config, /binding\s*=\s*"DOCUMENT_DELIVERY"/);
  assert.match(config, /id\s*=\s*"e45a57c874534b76b90107d43ad4a759"/);
});

test("production gateway and usage storage belong to the company account", () => {
  const config = fs.readFileSync(path.join(__dirname, "..", "wrangler.toml"), "utf8");
  assert.match(config, /^account_id\s*=\s*"3c3bcd08bb6ed3a7a8f98c292386c327"$/m);
  assert.match(config, /id\s*=\s*"e2ff82add8014f11aebf8bd1f6d95f8e"/);
  assert.doesNotMatch(config, /d62c9d8a0f9a487495da8a3f915ac083|8e340879954e455a909258ccd65dfaff/);
});
