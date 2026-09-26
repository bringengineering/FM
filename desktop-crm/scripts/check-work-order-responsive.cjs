'use strict';
// Optional browser QA: make Playwright available via NODE_PATH (no runtime dependency).
// Uses synthetic preview data and a fresh headless profile, never the installed CRM.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

async function main() {
  const server = spawn(process.execPath, ['scripts/operations-check-preview.js'], {
    cwd: path.resolve(__dirname, '..'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Preview startup timed out')), 15000);
      const fail = error => { clearTimeout(timer); reject(error); };
      server.once('error', fail);
      server.once('exit', code => fail(new Error(`Preview exited: ${code}`)));
      server.stdout.on('data', chunk => {
        const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
    });
    browser = await chromium.launch({ headless: true,
      ...(process.env.BRING_QA_BROWSER_CHANNEL ? { channel: process.env.BRING_QA_BROWSER_CHANNEL } : {}),
    });
    const context = await browser.newContext();
    await context.route('**/*', route => new URL(route.request().url()).origin === origin
      ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?view=workOrders&weeklySeed=1&performanceSeed=1`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /프로젝트 관리/ }).click();
    await page.locator('[data-wo-report-download]').waitFor({ state: 'visible' });
    for (const width of [375, 390, 700, 760, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const clipped = await page.locator('.operations-hero button,.operations-hero h2,.operations-hero p,.topbar button')
        .evaluateAll(elements => elements.filter(element => element.checkVisibility())
          .filter(element => { const rect = element.getBoundingClientRect(); return rect.left < 0 || rect.right > innerWidth + 1; })
          .map(element => element.textContent.trim()));
      assert.deepEqual(clipped, [], `Visible header controls clipped at ${width}px`);
      const logout = page.locator('.topbar [data-action="logout"]');
      await logout.waitFor({ state: 'visible' });
      await logout.click({ trial: true }); // Check reachability without ending the session.
      // Playwright checks hit targets and clipping, not just document.scrollWidth.
      await page.locator('[data-wo-report-download]').click();
      const dialog = page.getByRole('dialog', { name: '주간 성과보고서 다운로드', exact: true });
      await dialog.waitFor({ state: 'visible' });
      await dialog.locator('[data-close]').click();
      console.log(`PASS ${width}px: header controls visible and report dialog reachable`);
    }
    for (const width of [1366, 1920]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
      const home = page.locator('.project-workspace-home');
      await home.waitFor({ state: 'visible' });
      assert.equal(await home.locator('.project-workspace-health > div').count(), 3);
      assert.equal(await home.locator('.project-workspace-project-list button').count(), 6);
      const horizontalOverflow = await home.evaluate(element => element.scrollWidth > element.clientWidth + 1);
      assert.equal(horizontalOverflow, false, `Project home overflows at ${width}px`);
      const screenshot = path.join(os.tmpdir(), `bring-project-workspace-${width}.png`);
      await home.screenshot({ path: screenshot });
      console.log(`PASS ${width}px: project home metrics and list visible; screenshot ${screenshot}`);
    }
    const firstAction = page.locator('.project-workspace-action-list [data-wo-open-card]').first();
    const targetId = await firstAction.getAttribute('data-wo-open-card');
    await firstAction.click();
    await page.locator(`.wo-card[data-wo-card="${targetId}"]`).waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-performance-period="all"]').first().getAttribute('aria-pressed'), 'true');
    console.log('PASS today action opens the original work order outside the initial period filter');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
