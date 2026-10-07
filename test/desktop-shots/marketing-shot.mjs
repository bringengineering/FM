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
page.on("pageerror", e => console.log("[pageerror]", e.message.slice(0, 120)));
await page.addInitScript(() => {
  window.bringCRM = new Proxy({}, { get: (_t, k) => {
    const n = String(k);
    if (n.startsWith("on")) return () => () => {};
    if (n === "authState") return async () => ({ required: false, user: { displayName: "김관리", email: "manager@bring.co.kr" } });
    if (n === "load") return async () => ({ schemaVersion: 3, customers: [], buildings: [] });
    if (n === "loadOperations") return async () => ({ cases: [], payments: {}, caseSettings: {}, loadedAt: "" });
    if (n === "dataPath") return async () => "C:/tmp";
    if (n === "updateState") return async () => ({ status: "idle", currentVersion: "1.36.3" });
    if (/^(load|read)/.test(n)) return async () => [];
    return async () => ({ ok: true });
  }});
});
await page.goto(pathToFileURL(SRC).href);
await page.waitForSelector("#app:not(.app-locked)", { timeout: 15000 });
await page.waitForTimeout(700);
await page.locator('.workspace-folder-card[data-workspace-enter="marketing"]').first().click();
await page.waitForTimeout(1200);
await page.evaluate(() => { const m = document.getElementById("modal"); if (m) { m.classList.remove("open"); m.setAttribute("aria-hidden", "true"); } });
await page.screenshot({ path: path.join(OUT, "marketing-home.png") });
console.log("찍음: marketing-home");
const tabs = await page.evaluate(() =>
  [...document.querySelectorAll("[data-marketing-view],[data-marketing-tab],.marketing-nav button")]
    .filter(el => el.offsetParent)
    .map(el => el.dataset.marketingView || el.dataset.marketingTab || (el.textContent || "").trim().slice(0, 12)));
console.log("마케팅 화면들:", JSON.stringify(tabs));
await browser.close();
