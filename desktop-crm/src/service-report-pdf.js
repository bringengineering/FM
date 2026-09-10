"use strict";

const ServiceReportCore = require("./service-report-core");
const { safeFileSegment } = require("./attendance-xlsx");

function html(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

// 견적서와 같은 잠금이다. data: 이미지 외에는 아무것도 불러오지 않는다.
const CONTENT_SECURITY_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

function infoRow(label, value) {
  return `<div class="row"><dt>${html(label)}</dt><dd>${html(value || "—")}</dd></div>`;
}

function itemsHtml(items) {
  if (!items.length) return `<p class="empty">기록된 작업 항목이 없습니다.</p>`;
  return `<ul class="items">${items.map(item =>
    `<li class="${item.done ? "done" : "todo"}"><span class="mark">${item.done ? "완료" : "미완료"}</span>${html(item.label)}</li>`
  ).join("")}</ul>`;
}

function photoFigure(photo) {
  if (!photo) return `<figure class="photo empty-slot"></figure>`;
  return `<figure class="photo"><img src="${html(photo.dataUrl)}" alt="${html(`${photo.phaseLabel} ${photo.name}`)}"><figcaption><b>${html(photo.phaseLabel)}</b><span>${html(photo.name)}</span></figcaption></figure>`;
}

// 건물주가 보는 문서이므로 작업 전과 후를 같은 줄에 짝지어 놓는다. 따로
// 나열하면 무엇이 어떻게 바뀌었는지 알아볼 수 없다.
function photosHtml(photos) {
  // 파일이 첨부되지 않은 사진은 싣지 않는다. 회색 빈칸이 남으면 보고서를
  // 받는 쪽에 누락으로 읽힌다. 몇 장이 빠졌는지는 만드는 쪽에 알린다.
  const embedded = photos.filter(photo => photo.dataUrl);
  const before = embedded.filter(photo => photo.phase === "before");
  const after = embedded.filter(photo => photo.phase === "after");
  const rest = embedded.filter(photo => photo.phase !== "before" && photo.phase !== "after");
  if (!embedded.length) return `<p class="empty">첨부된 작업 사진이 없습니다.</p>`;

  const pairs = [];
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    pairs.push(`<div class="pair">${photoFigure(before[index])}${photoFigure(after[index])}</div>`);
  }
  const extra = rest.length
    ? `<div class="pair">${rest.map(photoFigure).join("")}</div>`
    : "";
  return `<div class="photos">${pairs.join("")}${extra}</div>`;
}

function createServiceReportHtml(report) {
  if (!report || typeof report !== "object") throw new Error("보고서 내용을 확인해 주세요.");
  const infoRows = [
    infoRow("현장", report.site),
    infoRow("주소", report.address),
    infoRow("작업 구분", report.service),
    infoRow("작업일", report.workedAtText),
    infoRow("접수번호", report.ticketNo),
    infoRow("담당", report.owner),
  ].join("");

  const amountBand = report.amountText
    ? `<div class="amount"><span>청구 금액 (VAT 포함)</span><b>${html(report.amountText)}</b></div>`
    : "";

  const contact = [report.company.phone, report.company.email].filter(Boolean).join(" · ");

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}"><title>${html(report.documentTitle)}</title><style>
@page{size:A4 portrait;margin:12mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#191F28;font-family:"Malgun Gothic","맑은 고딕",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{width:186mm}
.doc{display:flex;flex-direction:column;gap:6mm}
.head{display:flex;align-items:flex-end;justify-content:space-between;padding-bottom:3mm;border-bottom:1.6px solid #191F28}
.head h1{margin:0;font-size:20pt;font-weight:800;letter-spacing:.18em}
.head .meta{text-align:right;font-size:8.5pt;color:#8B95A1;line-height:1.5}
.head .meta b{display:block;color:#191F28;font-size:9.5pt}
.greeting{margin:0;font-size:9.5pt;line-height:1.6;color:#4E5968}
section>h2{margin:0 0 2mm;font-size:10.5pt;font-weight:800;color:#191F28}
.info{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #E5E8EB;border-radius:2mm;overflow:hidden}
.row{display:grid;grid-template-columns:24mm 1fr;border-bottom:.6px solid #E5E8EB}
.row:nth-last-child(-n+2){border-bottom:0}
.row dt,.row dd{margin:0;padding:2.2mm 3mm;font-size:8.5pt;display:flex;align-items:center}
.row dt{background:#F2F4F6;color:#4E5968;font-weight:700}
.row dd{color:#191F28}
.summary{margin:0;padding:3mm;border:1px solid #E5E8EB;border-radius:2mm;background:#F9FAFB;font-size:9pt;line-height:1.65}
.items{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:1.5mm 4mm}
.items li{display:flex;align-items:center;gap:2mm;font-size:8.8pt;padding:1.6mm 0;border-bottom:.6px solid #F2F4F6}
.mark{flex:none;min-width:13mm;padding:.8mm 0;border-radius:1mm;text-align:center;font-size:7pt;font-weight:800}
.done .mark{background:#E7F7EF;color:#1B8A5A}
.todo .mark{background:#FDF0E6;color:#B4690E}
.photos{display:grid;gap:4mm}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:4mm;break-inside:avoid}
.empty-slot{border:0}
.photo{margin:0;border:1px solid #E5E8EB;border-radius:2mm;overflow:hidden;break-inside:avoid}
.photo img{display:block;width:100%;height:52mm;object-fit:cover;background:#F2F4F6}
.photo figcaption{display:flex;align-items:baseline;gap:2mm;padding:2mm 3mm;border-top:1px solid #E5E8EB;font-size:8pt}
.photo figcaption b{color:#3182F6;font-weight:800}
.photo figcaption span{color:#8B95A1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.amount{display:flex;align-items:center;justify-content:space-between;padding:3.5mm 4mm;border-radius:2mm;background:#191F28;color:#fff}
.amount span{font-size:9pt;font-weight:700}
.amount b{font-size:15pt;font-weight:800}
.empty{margin:0;padding:4mm;border:1px dashed #E5E8EB;border-radius:2mm;color:#8B95A1;font-size:8.5pt;text-align:center}
footer{margin-top:2mm;padding-top:3mm;border-top:1px solid #E5E8EB;display:flex;justify-content:space-between;align-items:baseline;font-size:8pt;color:#8B95A1}
footer b{color:#191F28;font-size:9pt}
</style></head><body><main class="doc">
<header class="head"><h1>${html(report.documentTitle)}</h1><div class="meta"><b>${html(report.company.name)}</b>발행일 ${html(report.issuedAtText)}</div></header>
<p class="greeting">${html(report.ownerName || "건물주")}님, 요청하신 ${html(report.service)} 작업을 완료하여 그 결과를 아래와 같이 보고드립니다.</p>
<section><h2>작업 개요</h2><div class="info">${infoRows}</div></section>
${report.summary ? `<section><h2>작업 내용</h2><p class="summary">${html(report.summary)}</p></section>` : ""}
<section><h2>작업 항목</h2>${itemsHtml(report.items)}</section>
<section><h2>작업 전 · 후 사진</h2>${photosHtml(report.photos)}</section>
${amountBand}
<footer><span>${html(contact)}</span><b>${html(report.company.name)}</b></footer>
</main></body></html>`;
}

function serviceReportFileName(report) {
  const site = safeFileSegment(report && report.site ? report.site : "현장");
  const date = String((report && report.workedAt) || (report && report.issuedAt) || "").replace(/-/gu, "");
  return `${site}_작업결과보고서${date ? `_${date}` : ""}.pdf`;
}

module.exports = {
  createServiceReportHtml,
  serviceReportFileName,
  CONTENT_SECURITY_POLICY,
  buildServiceReport: ServiceReportCore.buildServiceReport,
};
