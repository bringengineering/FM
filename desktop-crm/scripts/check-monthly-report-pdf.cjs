"use strict";
// Generate layout QA only: synthetic building, work records and image swatches.
// No customer data, no network and no CRM database mutation.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");
const Core = require("../src/building-report-core");
const { createBuildingReportHtml } = require("../src/building-report-pdf");
async function main() {
  const output = path.resolve(process.argv[2] || "tmp/pdfs/monthly-activities");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    const swatches = await page.evaluate(() => Array.from({ length: 63 }, (_, n) => {
      const canvas = document.createElement("canvas");canvas.width = 600;canvas.height = 380;
      const ctx = canvas.getContext("2d");ctx.fillStyle = `hsl(${n * 41 % 360} 35% 88%)`;ctx.fillRect(0, 0, 600, 380);
      ctx.fillStyle = "#47687b";ctx.font = "24px sans-serif";ctx.fillText(`SYNTHETIC QA PHOTO ${n + 1}`, 50, 180);
      ctx.fillRect(50 + n, 240, 350, 4);
      return canvas.toDataURL("image/jpeg", .7);
    }));
    for (const [name, days] of [["sample", [2, 14]], ["full-month", Array.from({ length: 31 }, (_, n) => n + 1)]]) {
      const photos = days.flatMap((day, index) => Array.from({ length: name === "sample" && index === 1 ? 3 : 2 }, (_, n) => ({
        id: `synthetic_${day}_${n}`, date: `2026-10-${String(day).padStart(2, "0")}`, activityName: index % 2 ? "공용부청소" : "폐기물처리",
        caption: `날짜별 서로 다른 장면을 배치한 가상 검증 사진 ${n + 1}입니다.`, dataUrl: swatches[index * 2 + n],
      }))).reverse();
      const report = Core.buildBuildingMonthlyReport({ building: { id: "synthetic", name: "예시건물 · 검증용" }, month: "2026-10", issuedAt: "2026-10-31", photos,
        manualWorks: [{ date: "2026-10-02", kind: "폐기물처리", summary: "공용부에 모인 배출 물품을 분리하고 지정 장소로 옮긴 기록입니다. 현장 정리 상태를 확인했습니다.", done: true }],
        narrative: { summary: "이 문서는 양식 검증을 위한 가상 자료입니다. 10월 2일 폐기물처리 기록을 확인했습니다. 날짜별 활동명은 원래 기록대로 표시합니다. 완료 확인이 없는 사진 기록은 별도로 구분했습니다.", attention: "사진 기록만 있는 활동은 작업 결과 확인이 필요합니다.", nextMonthPlan: "확정된 공용부 청소 일정을 진행할 예정입니다." },
      });
      const html = createBuildingReportHtml(report);
      await page.setContent(html, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator("figure").count(), name === "sample" ? 5 : 62);
      assert.equal(await page.locator(".photo-group").count(), days.length);
      assert.equal(await page.locator("img").evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true);
      await page.pdf({ path: path.join(output, `${name}.pdf`), preferCSSPageSize: true, printBackground: true });
      await fs.writeFile(path.join(output, `${name}.html`), html);
    }
    console.log(`PASS: 5-photo sample and 62-photo/31-day PDF QA generated at ${output}; no external traffic.`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message);process.exitCode = 1; });
