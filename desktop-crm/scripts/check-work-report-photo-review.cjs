"use strict";
// Real renderer, synthetic photographs/CRM data only. No provider or production calls.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
function installFixture() {
  const photos = Array.from({ length: 8 }, (_, index) => ({ id: `synthetic_${index}`, name: index === 0 ? '<img src=x onerror="alert(1)">.jpg' : `예시 사진 ${index + 1}.jpg`, mimeType: "image/jpeg", kind: "file", parentName: index < 6 ? (index % 2 ? "작업 후" : "작업 전") : "" }));
  window.__photoQA = { calls: [], fail: false, delay: 0 };
  Object.assign(window.bringCRM, {
    loadWorkReports: async () => ({ reports: [], admin: true, canWork: true, uid: "preview-only" }),
    driveStatus: async () => ({ connected: true, email: "preview@example.invalid" }),
    browseWorkReportDrive: async () => ({ ok: true, folder: { id: "root", name: "내 드라이브" }, entries: photos }),
    loadWorkReportDriveThumbnail: async () => ({ ok: true, dataUrl: "" }),
    planWorkReportDrivePhotos: async input => ({ ok: true, plan: window.BringReportPhotoPlan.planFromTree({ name: "예시 사진", files: photos.filter(photo => input.fileIds.includes(photo.id)) }, { kind: input.kind, buildingName: input.buildingName }) }),
    classifyWorkReportPhotos: async input => {
      window.__photoQA.calls.push(input.fileIds.length);
      if (window.__photoQA.delay) await new Promise(resolve => setTimeout(resolve, window.__photoQA.delay));
      if (window.__photoQA.fail) throw new Error("가상 Gemini 연결 실패");
      return { ok: true, classifications: input.fileIds.map(id => ({ id, category: ["floor", "floor", "kitchen", "kitchen", "bath", "bath", "veranda", "veranda"][Number(id.split("_")[1])], confidence: 90, reason: "가상 구역 추천" })) };
    },
  });
}
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
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/preview-fixture.js") return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(__dirname, "operations-check-preview-fixture.js"), "utf8") + `\n(${installFixture.toString()})();` });
      return route.continue();
    });
    const page = await context.newPage(); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?view=workReports`, { waitUntil: "networkidle" });
    const workspace = page.locator('[data-workspace-enter="operations"][data-workspace-enter-folder="documents"]');
    if (await workspace.isVisible()) await workspace.click();
    await page.locator('[data-view="workReports"]').evaluate(button => button.click());
    await page.locator('[data-report-new]').click();
    await page.locator('[data-report-building]').selectOption('b1');
    const selectPhotos = async () => {
      await page.locator('[data-report-drive-open]').click();
      await page.locator('[data-report-drive-select-all]').click();
      await page.locator('[data-report-drive-plan]').click();
      await page.waitForFunction(() => document.querySelector('[data-report-photo-classify]')?.disabled === false);
    };
    await selectPhotos();
    assert.deepEqual(await page.evaluate(() => window.__photoQA.calls), [8], "선택 즉시 자동으로 분류해야 한다");
    assert.equal(await page.locator('[data-report-drive-apply]').isDisabled(), true);
    assert.equal(await page.locator('.wr-ai-photo-card.needs-review').count(), 2);
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    await page.locator('[data-report-photo-phase="synthetic_6"]').selectOption('before');
    await page.locator('[data-report-photo-phase="synthetic_7"]').selectOption('after');
    assert.equal(await page.locator('[data-report-drive-apply]').isEnabled(), true);
    await page.locator('[data-report-drive-apply]').click();
    assert.match(await page.locator('.wr-ai-photo-review header').textContent(), /배치 가능 8장/);
    const readPhotos = () => page.locator('[data-report-drop-photo]').count();
    // Report item photo rows use the existing removal controls; no database save is invoked.
    const before = await readPhotos();
    assert.equal(before, 8, "8장이 실제 보고서 항목에 붙어야 한다");
    await page.locator('[data-report-drive-apply]').click();
    assert.equal(await readPhotos(), before, "반복 적용은 중복 사진을 만들지 않는다");
    await page.locator('[data-report-photo-classify]').click();
    await page.waitForFunction(() => document.querySelector('[data-report-photo-classify]')?.disabled === false);
    assert.equal(await page.locator('.wr-ai-photo-card.needs-review').count(), 0, "재분류해도 전후 선택을 유지해야 한다");
    await page.evaluate(() => { window.__photoQA.fail = true; });
    await page.locator('[data-report-photo-classify]').click();
    await page.waitForFunction(() => document.querySelector('.wr-drive-error')?.textContent.includes('선택한 사진은 유지'));
    assert.equal(await page.locator('[data-report-photo-phase]').count(), 8, "실패해도 사진을 버리지 않는다");
    await page.setViewportSize({ width: 960, height: 1100 });
    assert.equal(await page.locator('[data-report-drive-apply]').isVisible(), true);
    if (process.env.BRING_QA_SCREENSHOT) await page.locator('.wr-drive').screenshot({ path: process.env.BRING_QA_SCREENSHOT });
    await page.evaluate(() => { window.__photoQA.fail = false; window.__photoQA.delay = 500; });
    await page.locator('[data-report-photo-classify]').click();
    await page.locator('[data-report-kind]').selectOption('stairs');
    await page.waitForTimeout(650);
    assert.equal(await page.locator('[data-report-photo-phase]').count(), 0, "이전 종류의 비동기 결과를 새 보고서에 적용하면 안 된다");
    assert.deepEqual(errors, []);
    console.log("PASS real renderer: automatic Gemini request, review gate, escaping, 8-photo retention, duplicate prevention, manual phase preservation, provider failure, stale-kind guard");
  } finally { await browser?.close(); server.kill(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
