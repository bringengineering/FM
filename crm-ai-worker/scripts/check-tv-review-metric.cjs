'use strict';
// Synthetic, local-only TV visual QA. No device pairing, CRM login or production data.
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const Wallboard = require('../../desktop-crm/src/company-wallboard');

async function main() {
  const { wallboardWebAssetResponse } = await import('../src/wallboard-web-assets.js');
  const dataDate = '2026-09-24';
  const model = Wallboard.project({
    projects: [{ id: 'preview-project', name: '가상 디지털 트윈 실증', status: 'active', progress: 70, startDate: '2026-09-14', endDate: '2026-10-02' }],
    orders: [
      { id: 'done', projectId: 'preview-project', assigneeUid: 'preview-1', assigneeName: '가상 직원', status: 'done', progress: 70, dueDate: '2026-09-22' },
      { id: 'submitted', projectId: 'preview-project', assigneeUid: 'preview-1', assigneeName: '가상 직원', status: 'submitted', progress: 70, dueDate: '2026-09-25' },
    ],
    calendar: { serviceRecords: [] },
  }, dataDate);
  const board = { model, playlist: [{ key: 'roadmap', enabled: true, seconds: 40 }, { key: 'portfolio', enabled: true, seconds: 25 }], notice: '', dataDate, version: 1, publishedAt: Date.now() };
  const server = http.createServer(async (request, response) => {
    if (request.url === '/tv/api/display') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ board }));
      return;
    }
    const asset = wallboardWebAssetResponse(new URL(request.url, 'http://127.0.0.1').pathname);
    response.writeHead(asset.status, Object.fromEntries(asset.headers));
    response.end(Buffer.from(await asset.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.BRING_QA_BROWSER_CHANNEL || 'msedge' });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/tv`, { waitUntil: 'networkidle' });
    await page.locator('#content .review-metric').waitFor({ state: 'visible' });
    assert.match(await page.locator('#content').innerText(), /입력 진도 평균/);
    assert.match(await page.locator('#content .review-metric').innerText(), /업무 검수 완료율[\s\S]*50%[\s\S]*1\/2건/);
    for (const [width, height] of [[1366, 768], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      const screenshot = path.join(os.tmpdir(), `bring-tv-review-${width}x${height}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, `TV horizontally overflows at ${width}x${height}`);
      const descriptionWidth = await page.locator('.overall-progress .progress-ring + div').evaluate(element => element.getBoundingClientRect().width);
      assert.ok(descriptionWidth >= 150, `Progress explanation is too narrow at ${width}x${height}: ${descriptionWidth}px`);
      console.log(`PASS ${width}x${height}: review metric visible; ${screenshot}`);
      await page.locator('#next').click();
      await page.locator('.portfolio-row').waitFor({ state: 'visible' });
      assert.match(await page.locator('.portfolio-row .reviewed-progress').innerText(), /50%[\s\S]*업무 검수 1\/2건/);
      const portfolioScreenshot = path.join(os.tmpdir(), `bring-tv-portfolio-${width}x${height}.png`);
      await page.screenshot({ path: portfolioScreenshot, fullPage: true });
      const portfolioOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(portfolioOverflow, false, `TV portfolio horizontally overflows at ${width}x${height}`);
      console.log(`PASS ${width}x${height}: per-project review visible; ${portfolioScreenshot}`);
      await page.locator('#previous').click();
      await page.locator('#content .review-metric').waitFor({ state: 'visible' });
    }
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
