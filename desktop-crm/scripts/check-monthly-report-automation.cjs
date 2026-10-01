"use strict";
// Optional headless QA against synthetic local data; all external traffic blocked.
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
async function main() {
  const server = spawn(process.execPath, ["scripts/operations-check-preview.js"], { cwd: path.resolve(__dirname, ".."), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let browser;
  try {
    const origin = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Preview startup timed out")), 15000);
      server.once("error", error => { clearTimeout(timeout); reject(error); });
      server.stdout.on("data", bytes => { const match = String(bytes).match(/http:\/\/127\.0\.0\.1:\d+/u); if (match) { clearTimeout(timeout); resolve(match[0]); } });
    });
    browser = await chromium.launch({ headless: true, channel: process.env.BRING_QA_BROWSER_CHANNEL || "chrome" });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?view=buildingMonthlyReports&monthlySeed=1`, { waitUntil: "networkidle" });
    const workspace = page.locator('[data-workspace-enter="operations"][data-workspace-enter-folder="documents"]');
    if (await workspace.isVisible()) await workspace.click();
    await page.locator('[data-view="buildingMonthlyReports"]').evaluate(button => button.click());
    await page.locator("[data-building-monthly-generate]").click();
    await page.locator('[data-building-monthly-drive-folder="syntheticMonthlyFolder01"]').click();
    await page.locator("[data-building-monthly-drive-scan]").click();
    await page.waitForFunction(() => document.querySelector('[data-building-monthly-copy="summary"]')?.value.includes("가상 초안"));
    assert.deepEqual(await page.evaluate(() => window.__monthlyQA.calls), ["find", "select:24", "select:24", "select:2", "draft"]);
    assert.equal(await page.locator(".building-monthly-photo-card").count(), 6);
    for (const width of [1280, 980, 760]) {
      await page.setViewportSize({ width, height: 1000 });
      const clipped = await page.locator("[data-building-monthly-generate]").evaluate(button => { const rect = button.getBoundingClientRect(); return rect.width < button.scrollWidth - 2 || rect.left < 0 || rect.right > innerWidth + 1; });
      assert.equal(clipped, false, `AI button clipped at ${width}px`);
    }
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-view="buildingMonthlyReports"]').evaluate(button => button.click());
    await page.locator("[data-building-monthly-generate]").click();
    await page.waitForFunction(() => document.querySelector('[data-building-monthly-copy="summary"]')?.value.includes("가상 초안"));
    assert.equal(await page.locator(".building-monthly-drive-overlay").count(), 0);
    await page.evaluate(() => { window.__monthlyQA.fail = true; });
    await page.locator("[data-building-monthly-generate]").click();
    await page.getByText("가상 Drive 읽기 실패", { exact: true }).waitFor();
    assert.match(await page.locator('[data-building-monthly-copy="summary"]').inputValue(), /가상 초안/u);
    await page.evaluate(() => { window.__monthlyQA.fail = false; window.__monthlyQA.delay = 600; window.__monthlyQA.calls = []; });
    await page.locator("[data-building-monthly-generate]").click();
    await page.locator("[data-building-monthly-building]").selectOption("b2");
    await page.waitForTimeout(900);
    assert.deepEqual(await page.evaluate(() => window.__monthlyQA.calls), ["find"]);
    assert.equal(await page.locator('[data-building-monthly-copy="summary"]').inputValue(), "");
    assert.deepEqual(errors, []);
    console.log("PASS: one-click photos/draft, 24-photo batches, remembered folder, failure preservation, stale-building cancellation, 760/980/1280px layout; external traffic blocked.");
  } finally { if (browser) await browser.close(); server.kill(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
