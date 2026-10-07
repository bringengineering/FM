import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Firebase Hosting export includes the authenticated partner application route", async () => {
  const html = await readFile(path.join(projectRoot, "firebase-public", "partner", "index.html"), "utf8");
  assert.match(html, /modulepreload[^>]+PartnerApp-[^" ]+\.js/);
  assert.match(html, /page:[^<]{0,40}partner/);
});
