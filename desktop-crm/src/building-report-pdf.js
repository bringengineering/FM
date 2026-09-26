"use strict";

const BuildingReportCore = require("./building-report-core");
const { safeFileSegment } = require("./attendance-xlsx");

function html(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

// 견적서·결과보고서와 같은 잠금.
const CONTENT_SECURITY_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

function statCard(label, value, tone) {
  return `<div class="stat${tone ? ` ${tone}` : ""}"><span>${html(label)}</span><b>${html(value || "—")}</b></div>`;
}

function worksHtml(works) {
  if (!works.length) {
    return `<p class="empty">이 기간에 처리한 업무가 없습니다.</p>`;
  }
  return `<table class="grid"><thead><tr><th>일자</th><th>호실</th><th>업무</th><th>내용</th><th>상태</th><th>금액</th></tr></thead><tbody>${
    works.map(work => `<tr><td>${html(work.dateText)}</td><td>${html(work.unit || "공용부")}</td><td>${html(work.kind)}</td><td class="left">${html(work.summary)}</td><td><span class="chip ${work.done ? "done" : "todo"}">${work.done ? "완료" : "진행 중"}</span></td><td class="money">${html(work.amountText)}</td></tr>`).join("")
  }</tbody></table>`;
}

function unitsHtml(units) {
  if (!units.length) return `<p class="empty">등록된 호실이 없습니다.</p>`;
  return `<div class="units">${units.map(unit =>
    `<div class="unit ${html(unit.status)}"><b>${html(unit.label)}</b><span>${html(unit.statusLabel)}</span>${
      unit.availableFrom ? `<small>${html(unit.availableFrom)} 입주 가능</small>` : ""
    }</div>`
  ).join("")}</div>`;
}

function createBuildingReportHtml(report) {
  if (!report || typeof report !== "object") throw new Error("보고서 내용을 확인해 주세요.");
  const summary = report.summary;
  const stats = [
    statCard("처리 업무", `${summary.workCount}건`),
    statCard("완료", `${summary.doneCount}건`, "good"),
    statCard("공실", summary.unitCount ? `${summary.vacantCount} / ${summary.unitCount}호실` : "", summary.vacantCount ? "warn" : ""),
    statCard("공실률", summary.vacancyRateText),
  ].join("");
  const contact = [report.company.phone, report.company.email].filter(Boolean).join(" · ");

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}"><title>${html(report.documentTitle)}</title><style>
@page{size:A4 portrait;margin:12mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#191F28;font-family:"Malgun Gothic","맑은 고딕",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{width:186mm}
.doc{display:flex;flex-direction:column;gap:6mm}
.head{display:flex;align-items:flex-end;justify-content:space-between;padding-bottom:3mm;border-bottom:1.6px solid #191F28}
.head h1{margin:0;font-size:19pt;font-weight:800;letter-spacing:.14em}
.head .sub{margin:1.5mm 0 0;font-size:10pt;color:#4E5968}
.head .meta{text-align:right;font-size:8.5pt;color:#8B95A1;line-height:1.5}
.head .meta b{display:block;color:#191F28;font-size:9.5pt}
.greeting{margin:0;font-size:9.5pt;line-height:1.6;color:#4E5968}
section>h2{margin:0 0 2mm;font-size:10.5pt;font-weight:800}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm}
.stat{padding:3mm;border:1px solid #E5E8EB;border-radius:2mm;text-align:center}
.stat span{display:block;font-size:7.8pt;color:#8B95A1}
.stat b{display:block;margin-top:1.2mm;font-size:13pt;font-weight:800}
.stat.good b{color:#1B8A5A}
.stat.warn b{color:#B4690E}
.grid{width:100%;border-collapse:collapse;table-layout:fixed}
.grid th,.grid td{border-bottom:.6px solid #E5E8EB;padding:2mm 1.5mm;font-size:8.2pt;text-align:center;vertical-align:middle;word-break:keep-all}
.grid thead th{background:#F2F4F6;color:#4E5968;font-weight:700;font-size:7.8pt;border-bottom:1px solid #E5E8EB}
.grid td.left{text-align:left}
.grid td.money{text-align:right;white-space:nowrap}
.grid th:nth-child(1){width:13mm}.grid th:nth-child(2){width:18mm}.grid th:nth-child(3){width:24mm}
.grid th:nth-child(5){width:17mm}.grid th:nth-child(6){width:24mm}
.chip{display:inline-block;padding:.7mm 2mm;border-radius:1mm;font-size:7pt;font-weight:800}
.chip.done{background:#E7F7EF;color:#1B8A5A}
.chip.todo{background:#FDF0E6;color:#B4690E}
.units{display:grid;grid-template-columns:repeat(5,1fr);gap:2.5mm}
.unit{padding:2.5mm 2mm;border:1px solid #E5E8EB;border-radius:2mm;text-align:center}
.unit b{display:block;font-size:9pt}
.unit span{display:block;margin-top:.8mm;font-size:7.5pt;color:#8B95A1}
.unit small{display:block;margin-top:.6mm;font-size:6.8pt;color:#8B95A1}
.unit.vacant{border-color:#F5C888;background:#FFFBF5}
.unit.vacant span{color:#B4690E;font-weight:700}
.unit.move_out_scheduled{border-color:#BBD8FA;background:#F7FAFF}
.unit.move_out_scheduled span{color:#3182F6;font-weight:700}
.total{display:flex;align-items:center;justify-content:space-between;padding:3.5mm 4mm;border-radius:2mm;background:#191F28;color:#fff}
.total span{font-size:9pt;font-weight:700}
.total b{font-size:15pt;font-weight:800}
.empty{margin:0;padding:4mm;border:1px dashed #E5E8EB;border-radius:2mm;color:#8B95A1;font-size:8.5pt;text-align:center}
footer{margin-top:2mm;padding-top:3mm;border-top:1px solid #E5E8EB;display:flex;justify-content:space-between;align-items:baseline;font-size:8pt;color:#8B95A1}
footer b{color:#191F28;font-size:9pt}
</style></head><body><main class="doc">
<header class="head"><div><h1>${html(report.documentTitle)}</h1><p class="sub">${html(report.buildingName)} · ${html(report.monthText)}</p></div><div class="meta"><b>${html(report.company.name)}</b>발행일 ${html(report.issuedAt)}</div></header>
<p class="greeting">${html(report.ownerName || "건물주")}님, ${html(report.monthText)} ${html(report.buildingName)} 관리 내역을 보고드립니다.${report.address ? ` (${html(report.address)})` : ""}</p>
<section><h2>이 달 요약</h2><div class="stats">${stats}</div></section>
<section><h2>처리한 업무</h2>${worksHtml(report.works)}</section>
<section><h2>호실 현황</h2>${unitsHtml(report.units)}</section>
${summary.billedText ? `<div class="total"><span>${html(report.monthText)} 청구 합계</span><b>${html(summary.billedText)}</b></div>` : ""}
<footer><span>${html(contact)}</span><b>${html(report.company.name)}</b></footer>
</main></body></html>`;
}

function buildingReportFileName(report) {
  const name = safeFileSegment(report && report.buildingName ? report.buildingName : "건물");
  const month = String((report && report.month) || "").replace(/-/gu, "");
  return `${name}_월간관리보고서${month ? `_${month}` : ""}.pdf`;
}

module.exports = {
  createBuildingReportHtml,
  buildingReportFileName,
  CONTENT_SECURITY_POLICY,
  buildBuildingMonthlyReport: BuildingReportCore.buildBuildingMonthlyReport,
};
