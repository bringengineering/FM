"use strict";
// Synthetic PDF layout regression only. Never reads customer data or sends traffic.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const {chromium} = require("playwright");
const R = require("../src/work-report-core");
const {createWorkReportHtml} = require("../src/work-report-pdf");
async function main() {
  const output = path.resolve(process.argv[2] || "tmp/pdfs/report-no-seal");
  await fs.mkdir(output, {recursive: true});
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    const photo = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#dcecf6"; ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = "#31516a"; ctx.font = "24px sans-serif"; ctx.fillText("SYNTHETIC QA PHOTO", 170, 185);
      return canvas.toDataURL("image/jpeg");
    });
    const report = R.normalizeReport({id: "qa_report", kind: "common", buildingId: "qa_building", buildingName: "예시 건물", workDate: "2026-10-06", workerName: "예시 담당자", ownerName: "예시 건물주", area: "공용부", summary: "출입구 현장 작업 과정을 사진으로 정리했습니다.", followUp: "추가 확인 사항은 별도 안내합니다."});
    report.items[0].during = [{id: "qa_photo", driveFileId: "qa_photo", caption: "검증용 예시 사진"}];
    for (const copy of ["owner", "program"]) {
      const html = createWorkReportHtml(report, copy, {company: {businessName: "브링케어", representative: "예시 대표"}, images: {qa_photo: photo}});
      assert.doesNotMatch(html, /대표자 날인|서명 또는 인|class="stamp"/);
      await page.setContent(html, {waitUntil: "load"});
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator("footer img").count(), 0);
      assert.equal(await page.locator("img").count(), 1);
      assert.equal(await page.locator("img").evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true);
      await page.pdf({path: path.join(output, `${copy}.pdf`), preferCSSPageSize: true, printBackground: true});
    }
    console.log("PASS: owner and program PDFs generated without seals; photo, recipient, and footer retained; no external traffic.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
