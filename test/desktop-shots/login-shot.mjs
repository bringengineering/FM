import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../../desktop-crm/src/index.html");
const OUT = path.resolve(here, "out");
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
await page.addInitScript(() => {
  window.bringCRM = new Proxy({}, {
    get: (_t, key) => {
      if (String(key).startsWith("on")) return () => () => {};
      if (key === "authState") return async () => ({ required: true, user: null, error: "" });
      return async () => ({ ok: true });
    }
  });
});
await page.goto(pathToFileURL(SRC).href);
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, "01-login.png") });
console.log("찍음: 01-login");
await browser.close();
