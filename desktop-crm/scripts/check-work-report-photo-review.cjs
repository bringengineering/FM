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
    loadWorkReportDriveThumbnail: async input => {
      const canvas = document.createElement("canvas"); canvas.width = 480; canvas.height = 300;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#c6c8c6"; ctx.fillRect(0, 0, 480, 300);
      ctx.strokeStyle = "#f1f4f6"; for (let x = 0; x < 480; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 300); ctx.stroke(); }
      for (let y = 0; y < 300; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(480, y); ctx.stroke(); }
      if (Number(input.fileId.split("_")[1]) % 2 === 0) { ctx.fillStyle = "#777268"; for (let i = 0; i < 40; i++) ctx.fillRect((i * 47) % 460, (i * 31) % 280, 5, 4); }
      ctx.fillStyle = "#314e63"; ctx.font = "20px sans-serif"; ctx.fillText("TEST FIXTURE", 160, 150);
      return { ok: true, dataUrl: canvas.toDataURL("image/jpeg") };
    },
    planWorkReportDrivePhotos: async input => ({ ok: true, plan: window.BringReportPhotoPlan.planFromTree({ name: "예시 사진", files: photos.filter(photo => input.fileIds.includes(photo.id)) }, { kind: input.kind, buildingName: input.buildingName }) }),
    classifyWorkReportPhotos: async input => {
      window.__photoQA.calls.push({ count: input.fileIds.length, mode: input.mode || "classify" });
      if (window.__photoQA.delay) await new Promise(resolve => setTimeout(resolve, window.__photoQA.delay));
      if (window.__photoQA.fail) throw new Error("가상 Gemini 연결 실패");
      if (input.mode === "compare") return { ok: true, classifications: [], pairs: [{ beforeId: input.fileIds[0], afterId: input.fileIds[1], evidence: "debris_removed" }] };
      const captureTimes = input.fileIds.map(id => { const n = Number(id.split("_")[1]); return { id, captureTime: n < 6 ? { local: `2026-10-02T${n % 2 ? "16:40:45" : "14:04:14"}`, offset: "+09:00", source: "exif-original" } : null }; });
      return { ok: true, captureTimes, classifications: input.fileIds.map(id => { const n = Number(id.split("_")[1]); return { id, category: ["veranda", "veranda", "kitchen", "kitchen", "bath", "bath", "review", "review"][n], space: ["veranda", "veranda", "kitchen", "kitchen", "bath", "bath", "unknown", "unknown"][n], target: n < 2 ? "floor" : n < 6 ? "sink" : "unknown", confidence: 90, reason: "가상 구역 추천" }; }) };
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
    assert.deepEqual(await page.evaluate(() => window.__photoQA.calls.map(row => row.mode)), ["classify", "compare", "compare", "compare"], "구역 분류 다음 같은 구역 사진끼리 비교해야 한다");
    assert.equal(await page.locator('[data-report-drive-apply]').isDisabled(), true);
    assert.equal(await page.locator('.wr-pair-single.needs-review').count(), 2);
    assert.equal(await page.locator('.wr-pair-card').count(), 3);
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    assert.equal(await page.locator('.wr-photo-capture-time').count(), 8);
    assert.match(await page.locator('.wr-pair-help').textContent(), /촬영시간 6\/8장 확인/u);
    assert.equal(await page.locator('.wr-photo-capture-time').filter({ hasText: '원본 촬영시간 없음' }).count(), 2);
    assert.equal(await page.locator('.wr-photo-capture-time').filter({ hasText: '2026-10-02 14:04:14' }).count(), 3);
    if (process.env.BRING_QA_SCREENSHOT) {
      await page.locator('.wr-ai-photo-section').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: process.env.BRING_QA_SCREENSHOT });
    }
    await page.locator('[data-report-review-confirm-pair]').first().check();
    await page.locator('[data-report-drive-apply]').click();
    assert.equal(await page.locator('[data-report-drop-photo]').count(), 2, "미확인 사진은 남겨 두고 확인한 짝만 적용한다");
    await page.locator('[data-report-review-swap]').first().click();
    assert.equal(await page.locator('[data-report-drive-apply]').isDisabled(), true, "전후를 바꾸면 다시 확인해야 한다");
    await page.locator('[data-report-review-confirm-pair]').first().check();
    await page.locator('[data-report-drive-apply]').click();
    assert.equal(await page.locator('[data-report-drop-photo]').count(), 2, "전후 바꾸기 재적용도 중복이 없다");
    await page.locator('[data-report-review-select-all]').click();
    await page.locator('[data-report-review-bulk="space"]').selectOption('veranda');
    await page.locator('[data-report-review-bulk="target"]').selectOption('floor');
    await page.locator('[data-report-review-bulk-apply]').click();
    await page.locator('[data-report-photo-phase="synthetic_6"]').selectOption('before');
    await page.locator('[data-report-photo-phase="synthetic_7"]').selectOption('after');
    await page.locator('[data-report-review-manual-pair]').click();
    assert.equal(await page.locator('.wr-pair-card').count(), 4);
    for (let i = 0; i < 4; i++) await page.locator('[data-report-review-confirm-pair]').nth(i).check();
    assert.equal(await page.locator('[data-report-drive-apply]').isEnabled(), true);
    await page.locator('[data-report-drive-apply]').click();
    assert.match(await page.locator('.wr-pair-summary').textContent(), /확인 완료 8장/);
    const readPhotos = () => page.locator('[data-report-drop-photo]').count();
    // Report item photo rows use the existing removal controls; no database save is invoked.
    const before = await readPhotos();
    assert.equal(before, 8, "8장이 실제 보고서 항목에 붙어야 한다");
    await page.locator('[data-report-drive-apply]').click();
    assert.equal(await readPhotos(), before, "반복 적용은 중복 사진을 만들지 않는다");
    await page.locator('[data-report-photo-classify]').click();
    await page.waitForFunction(() => document.querySelector('[data-report-photo-classify]')?.disabled === false);
    assert.equal(await page.locator('.wr-pair-single.needs-review').count(), 0, "재분류해도 전후 선택을 유지해야 한다");
    assert.equal(await page.locator('[data-report-review-confirm-pair]:checked').count(), 4);
    await page.evaluate(() => { window.__photoQA.fail = true; });
    await page.locator('[data-report-photo-classify]').click();
    await page.waitForFunction(() => document.querySelector('.wr-drive-error')?.textContent.includes('선택한 사진은 유지'));
    assert.equal(await page.locator('.wr-pair-card figure').count(), 8, "실패해도 사진을 버리지 않는다");
    await page.setViewportSize({ width: 960, height: 1100 });
    assert.equal(await page.locator('[data-report-drive-apply]').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false, "좁은 화면에서 가로 넘침이 없어야 한다");
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
