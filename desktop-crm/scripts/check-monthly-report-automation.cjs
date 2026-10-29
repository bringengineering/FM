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
    const caption = '폐기물과 적치 물품 정리 · <img src=x onerror="alert(1)">';
    const firstPhoto = page.locator('.building-monthly-photo-card').first();
    const photoId = await firstPhoto.locator('[data-building-monthly-caption-edit]').getAttribute('data-building-monthly-caption-edit');
    await firstPhoto.getByRole('button', { name: '설명 수정' }).click();
    const captionInput = page.locator('#buildingMonthlyPhotoCaption');
    await captionInput.fill(caption);
    await page.locator('[data-building-monthly-caption-form]').getByRole('button', { name: '설명 저장' }).click();
    assert.equal(await firstPhoto.locator('b').textContent(), caption);
    assert.equal(await page.locator('.building-monthly-activity-photo-grid figcaption span').first().textContent(), caption);
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    await page.locator('[data-building-monthly-pdf]').click();
    await page.waitForFunction(() => window.__monthlyQA.exported);
    assert.equal(await page.evaluate(id => window.__monthlyQA.exported.photos.find(photo => photo.id === id)?.caption, photoId), caption);
    await firstPhoto.getByRole('button', { name: '설명 수정' }).click();
    await captionInput.fill('취소될 내용');
    await page.locator('[data-building-monthly-caption-form]').getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(await firstPhoto.locator('b').textContent(), caption);
    await page.locator('[data-building-monthly-photos-select]').click();
    await page.waitForFunction(() => !document.querySelector('[data-building-monthly-photos-select]')?.disabled);
    assert.equal(await firstPhoto.locator('b').textContent(), caption);
    await page.locator('[data-building-monthly-generate]').click();
    await page.waitForFunction(() => document.querySelector('[data-building-monthly-copy="summary"]')?.value.includes('가상 초안') && !document.querySelector('[data-building-monthly-generate]')?.disabled);
    assert.equal(await firstPhoto.locator('b').textContent(), caption);
    // Editor is available both in the source list and under the report photo.
    await page.locator('.building-monthly-activity-photo-grid [data-building-monthly-caption-edit]').first().click();
    assert.equal(await captionInput.inputValue(), caption);
    for (const width of [1280, 760, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200); // Existing modal size/position transition is 160 ms.
      const bounds = await page.locator('.modal-card:has(.building-monthly-caption-editor)').evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, viewport: innerWidth, scroll: el.scrollWidth, client: el.clientWidth }; });
      assert.ok(bounds.left >= 0 && bounds.right <= bounds.viewport && bounds.scroll <= bounds.client + 1, `Caption editor clipped at ${width}px: ${JSON.stringify(bounds)}`);
    }
    if (process.env.BRING_QA_OUTPUT_DIR) {
      require('node:fs').mkdirSync(process.env.BRING_QA_OUTPUT_DIR, { recursive: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.locator('.modal-card:has(.building-monthly-caption-editor)').screenshot({ path: path.join(process.env.BRING_QA_OUTPUT_DIR, 'monthly-caption-editor.png') });
    }
    await page.locator('[data-building-monthly-caption-form]').getByRole('button', { name: '취소', exact: true }).click();
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
    console.log("PASS: caption save/cancel, HTML escaping, PDF request, rescan preservation, 360/760/1280px editor; one-click photos/draft, 24-photo batches, remembered folder, failure preservation, stale-building cancellation; external traffic blocked.");
  } finally { if (browser) await browser.close(); server.kill(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
