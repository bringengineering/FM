"use strict";
// Real renderer, synthetic photographs/CRM data only. No provider or production calls.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
function installFixture() {
  const phase = n => n < 3 || (n >= 8 && n < 12) || (n >= 14 && n < 16) || n >= 20 ? "작업 전" : n < 18 ? "작업 후" : "";
  const space = n => n < 8 || n >= 20 ? "bath" : n < 14 ? "kitchen" : n < 18 ? "veranda" : "unknown";
  const photos = Array.from({ length: 22 }, (_, index) => ({ id: `synthetic_${index}`, name: index === 0 ? '<img src=x onerror="alert(1)">.jpg' : `예시 사진 ${index + 1}.jpg`, mimeType: "image/jpeg", kind: "file", parentName: phase(index) }));
  window.__photoQA = { calls: [], aiCalls: [], fail: false, planFail: false, delay: 0, aiFail: false, aiDelay: 0 };
  Object.assign(window.bringCRM, {
    assist: async input => {
      window.__photoQA.aiCalls.push(input);
      if (window.__photoQA.aiDelay) await new Promise(resolve => setTimeout(resolve, window.__photoQA.aiDelay));
      if (window.__photoQA.aiFail) throw new Error("가상 문장 작성 실패");
      return { result: { text: `사진 분류를 반영한 검토용 초안 ${window.__photoQA.aiCalls.length}. 완료 여부는 담당자가 확인합니다.${window.__photoQA.longDraft ? '\n구역별 현장 사진 안내입니다.\n'.repeat(65) : ''}` } };
    },
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
    planWorkReportDrivePhotos: async input => {
      if (window.__photoQA.planFail) throw new Error("가상 가져오기 실패");
      return { ok: true, plan: window.BringReportPhotoPlan.planFromTree({ name: "예시 사진", files: photos.filter(photo => input.fileIds.includes(photo.id)) }, { kind: input.kind, buildingName: input.buildingName }) };
    },
    classifyWorkReportPhotos: async input => {
      window.__photoQA.calls.push({ count: input.fileIds.length, mode: input.mode || "classify" });
      if (window.__photoQA.delay) await new Promise(resolve => setTimeout(resolve, window.__photoQA.delay));
      if (window.__photoQA.fail) throw new Error("가상 Gemini 연결 실패");
      // Deliberately provide no pairs: explicit phases still form multi-photo areas.
      if (input.mode === "compare") return { ok: true, classifications: [], pairs: [] };
      const captureTimes = input.fileIds.map(id => { const n = Number(id.split("_")[1]); return { id, captureTime: phase(n) ? { local: `2026-10-02T${phase(n) === "작업 후" ? "16:40:45" : "14:04:14"}`, offset: "+09:00", source: "exif-original" } : null }; });
      return { ok: true, captureTimes, classifications: input.fileIds.map(id => { const n = Number(id.split("_")[1]); return { id, category: space(n) === "unknown" ? "review" : space(n), space: space(n), target: space(n) === "unknown" ? "unknown" : "sink", confidence: 90, reason: "가상 구역 추천" }; }) };
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
      await page.locator('[data-report-drive-file="synthetic_20"]').click();
      await page.locator('[data-report-drive-file="synthetic_21"]').click();
      await page.locator('[data-report-drive-plan]').click();
      await page.waitForFunction(() => document.querySelector('[data-report-photo-classify]')?.disabled === false);
    };
    await selectPhotos();
    await page.waitForFunction(() => document.querySelector('[name="summary"]')?.value.includes('검토용 초안 1'));
    assert.deepEqual(await page.evaluate(() => window.__photoQA.calls.map(row => row.mode)), ["classify", "compare", "compare", "compare"], "구역 분류 다음 같은 구역 사진끼리 비교해야 한다");
    assert.equal(await page.locator('[data-report-drive-apply]').isEnabled(), true);
    assert.equal(await page.locator('[data-report-drop-photo]').count(), 18, "확인 버튼 없이 분류된 사진 18장이 자동 반영된다");
    assert.equal(await page.locator('[data-report-review-confirm-area]:checked').count(), 0, "초안 자동 배치는 사람의 확인이 아니다");
    assert.match(await page.locator('.wr-blockers').textContent(), /AI 추천 사진 18장/);
    assert.equal(await page.locator('[data-report-form] button[type="submit"]').isDisabled(), true);
    assert.match(await page.locator('.wr-auto-draft-notice').textContent(), /확인 필요 2장 보관/);
    await page.locator('[name="summary"]').fill('담당자가 직접 작성한 본문');
    await page.evaluate(() => { window.__photoQA.longDraft = true; });
    await page.locator('[data-report-ai-draft]').click();
    await page.locator('[data-report-ai-accept]').waitFor();
    assert.equal(await page.locator('[name="summary"]').inputValue(), '담당자가 직접 작성한 본문');
    // A long suggestion and pending photos must never trap the save controls
    // below a clipped sticky sidebar, even at laptop heights or increased zoom.
    for (const viewport of [{ width: 1520, height: 940 }, { width: 1280, height: 720 }, { width: 960, height: 720 }]) {
      await page.setViewportSize(viewport);
      const actions = page.locator('.wr-ai-finish-actions');
      await actions.scrollIntoViewIfNeeded();
      const reachable = await actions.evaluate(element => {
        const button = element.querySelector('[data-report-cancel]');
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return rect.top >= 0 && rect.bottom <= innerHeight && (hit === button || button.contains(hit));
      });
      assert.equal(reachable, true, `긴 제안에서도 저장·취소 버튼에 도달해야 한다 (${viewport.width}×${viewport.height})`);
      assert.equal(await page.locator('[data-report-form] button[type="submit"]').isDisabled(), true, "스크롤 수정은 검토 게이트를 우회하지 않는다");
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.evaluate(() => { window.__photoQA.longDraft = false; });
    await page.locator('[data-report-ai-accept]').click();
    assert.match(await page.locator('[name="summary"]').inputValue(), /검토용 초안 2/);
    assert.equal(await page.locator('.wr-pair-single.needs-review').count(), 2);
    assert.equal(await page.locator('.wr-area-card').count(), 3);
    const bath = () => page.locator('[data-report-area="bath"]');
    const phaseCount = async (space, phase) => page.locator(`[data-report-area="${space}"] [data-report-area-phase="${phase}"] figure`).count();
    assert.equal(await phaseCount('bath', 'before'), 3);
    assert.equal(await phaseCount('bath', 'after'), 5);
    assert.equal(await phaseCount('kitchen', 'before'), 4);
    assert.equal(await phaseCount('kitchen', 'after'), 2);
    assert.equal(await page.locator('[data-report-review-manual-pair]').count(), 0);
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    assert.equal(await page.locator('.wr-photo-capture-time').count(), 20);
    assert.match(await page.locator('.wr-pair-help').textContent(), /촬영시간 18\/20장 확인/u);
    assert.equal(await page.locator('.wr-photo-capture-time').filter({ hasText: '원본 촬영시간 없음' }).count(), 2);
    assert.equal(await page.locator('.wr-photo-capture-time').filter({ hasText: '2026-10-02 14:04:14' }).count(), 9);
    if (process.env.BRING_QA_SCREENSHOT) {
      await page.locator('.wr-ai-photo-section').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: process.env.BRING_QA_SCREENSHOT });
    }
    await page.locator('[data-report-review-confirm-area="bath"]').check();
    await page.locator('[data-report-drive-apply]').click();
    assert.equal(await page.locator('[data-report-drop-photo]').count(), 18, "일부 구역 확인은 이미 반영한 사진을 버리지 않는다");
    await page.locator('[data-report-review-edit="synthetic_0"]').click();
    await page.locator('[data-report-photo-phase="synthetic_0"]').selectOption('after');
    assert.equal(await page.locator('[data-report-review-confirm-area="bath"]').isChecked(), false, "사진 이동 후 구역 재확인이 필요하다");
    assert.equal(await phaseCount('bath', 'before'), 2);
    assert.equal(await phaseCount('bath', 'after'), 6);
    await page.locator('[data-report-review-confirm-area="bath"]').check();
    await page.locator('[data-report-drive-apply]').click();
    assert.equal(await page.locator('[data-report-drop-photo]').count(), 18, "전후 바꾸기 재적용도 중복이 없다");
    await page.locator('[data-report-review-collapse="bath"]').click();
    assert.equal(await bath().locator('figure').count(), 0);
    await page.locator('[data-report-review-collapse="bath"]').click();
    assert.equal(await bath().locator('figure').count(), 8);
    await page.locator('.wr-pair-bulk summary').click();
    await page.locator('[data-report-review-select-all]').click();
    await page.locator('[data-report-review-bulk="space"]').selectOption('veranda');
    await page.locator('[data-report-review-bulk="target"]').selectOption('floor');
    await page.locator('[data-report-review-bulk-apply]').click();
    await page.locator('[data-report-photo-phase="synthetic_18"]').selectOption('before');
    await page.locator('[data-report-photo-phase="synthetic_19"]').selectOption('after');
    assert.equal(await page.locator('.wr-area-card').count(), 3);
    assert.equal(await page.locator('.wr-pair-single').count(), 0);
    for (const space of ['bath', 'kitchen', 'veranda']) await page.locator(`[data-report-review-confirm-area="${space}"]`).check();
    assert.equal(await page.locator('[data-report-drive-apply]').isEnabled(), true);
    await page.locator('[data-report-drive-apply]').click();
    assert.match(await page.locator('.wr-pair-summary').textContent(), /확인 완료 20장/);
    const readPhotos = () => page.locator('[data-report-drop-photo]').count();
    // Report item photo rows use the existing removal controls; no database save is invoked.
    const before = await readPhotos();
    assert.equal(before, 20, "20장이 실제 보고서 항목에 붙어야 한다");
    await page.locator('[data-report-drive-apply]').click();
    assert.equal(await readPhotos(), before, "반복 적용은 중복 사진을 만들지 않는다");
    await page.locator('[data-report-photo-classify]').click();
    await page.waitForFunction(() => document.querySelector('[data-report-photo-classify]')?.disabled === false);
    assert.equal(await page.locator('.wr-pair-single.needs-review').count(), 0, "재분류해도 전후 선택을 유지해야 한다");
    assert.equal(await page.locator('[data-report-review-confirm-area]:checked').count(), 3);
    assert.equal(await page.evaluate(() => window.__photoQA.aiCalls.length), 2, "기존 문장이 있으면 재분석이 본문을 덮어쓰거나 새 AI 호출을 하지 않는다");
    // Add to one phase without resetting previously reviewed photos.
    await page.locator('[data-report-review-add="bath"][data-report-review-add-phase="after"]').click();
    await page.locator('[data-report-drive-file="synthetic_20"]').click();
    await page.locator('[data-report-drive-plan]').click();
    await page.waitForFunction(() => document.querySelector('[data-report-photo-classify]')?.disabled === false);
    assert.equal(await phaseCount('bath', 'after'), 7);
    assert.match(await page.locator('.wr-pair-summary').textContent(), /확인 완료 20장/);
    await page.locator('[data-report-review-confirm-area="bath"]').check();
    await page.locator('[data-report-drive-apply]').click();
    assert.equal(await readPhotos(), 21);
    await page.evaluate(() => { window.__photoQA.planFail = true; });
    await page.locator('[data-report-review-add="bath"][data-report-review-add-phase="before"]').click();
    await page.locator('[data-report-drive-file="synthetic_21"]').click();
    await page.locator('[data-report-drive-plan]').click();
    await page.waitForFunction(() => document.querySelector('.wr-drive-error')?.textContent.includes('가상 가져오기 실패'));
    await page.locator('[data-report-drive-close]').first().click();
    assert.equal(await page.locator('.wr-area-photo').count(), 21, "추가 실패도 이전 사진을 유지한다");
    await page.evaluate(() => { window.__photoQA.planFail = false; });
    await page.evaluate(() => { window.__photoQA.fail = true; });
    await page.locator('[data-report-photo-classify]').click();
    await page.waitForFunction(() => document.querySelector('.wr-drive-error')?.textContent.includes('선택한 사진은 유지'));
    assert.equal(await page.locator('.wr-area-card figure').count(), 21, "실패해도 사진을 버리지 않는다");
    await page.evaluate(() => { window.__photoQA.aiFail = true; });
    await page.locator('[name="summary"]').fill('');
    await page.locator('[data-report-ai-draft]').click();
    await page.waitForFunction(() => document.querySelector('.wr-ai-error')?.textContent.includes('사진과 입력 내용은 유지'));
    assert.equal(await readPhotos(), 21);
    await page.evaluate(() => { window.__photoQA.aiFail = false; });
    await page.locator('[data-report-ai-draft]').click();
    await page.waitForFunction(() => document.querySelector('[name="summary"]')?.value.includes('검토용 초안 4'));
    // Directly typing while a late response is in flight must not be lost.
    await page.evaluate(() => { window.__photoQA.aiDelay = 400; });
    await page.locator('[name="summary"]').fill('');
    await page.locator('[data-report-ai-draft]').click();
    await page.locator('[name="summary"]').fill('응답 대기 중 작성한 문장');
    await page.locator('[data-report-ai-accept]').waitFor();
    assert.equal(await page.locator('[name="summary"]').inputValue(), '응답 대기 중 작성한 문장');
    // Removing a report photo must not silently re-add it on draft generation.
    await page.locator('[data-report-drop-photo="synthetic_20"]').click();
    assert.equal(await readPhotos(), 20);
    await page.locator('[data-report-ai-draft]').click();
    await page.locator('[data-report-ai-accept]').waitFor();
    assert.equal(await readPhotos(), 20);
    await page.setViewportSize({ width: 960, height: 1100 });
    assert.equal(await page.locator('[data-report-drive-apply]').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false, "좁은 화면에서 가로 넘침이 없어야 한다");
    await page.evaluate(() => { window.__photoQA.fail = false; window.__photoQA.delay = 500; });
    await page.locator('[data-report-photo-classify]').click();
    await page.locator('[data-report-kind]').selectOption('stairs');
    await page.waitForTimeout(650);
    assert.equal(await page.locator('[data-report-photo-phase]').count(), 0, "이전 종류의 비동기 결과를 새 보고서에 적용하면 안 된다");
    assert.deepEqual(errors, []);
    console.log("PASS real renderer: automatic 18-photo draft with 2 unresolved retained, no false confirmation, manual text/suggestion preservation, retry, late typing, removed-photo retention, unequal area groups, moves, addition, save review gate, escaping, duplicate prevention, provider failure, responsive layout, stale-kind guard");
  } finally { await browser?.close(); server.kill(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
