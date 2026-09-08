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

test("daily report Telegram delivery is enabled only after secret verification and keeps credentials out of config", () => {
  const config = fs.readFileSync(path.join(__dirname, "..", "wrangler.toml"), "utf8");
  assert.match(config, /^TELEGRAM_DAILY_REPORT_ENABLED\s*=\s*"true"$/m);
  assert.doesNotMatch(config, /^(?:CRM_DAILY_REPORT_EMAILS|TELEGRAM_BOT_TOKEN|TELEGRAM_WORK_CHAT_ID)\s*=/m);
});
