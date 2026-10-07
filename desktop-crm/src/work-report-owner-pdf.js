"use strict";

const Core = require("./work-report-core");
const PHASES = { before: "작업 전", during: "작업 중", after: "작업 후" };
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);
const count = item => item.before.length + item.during.length + item.after.length;

// Keep uneven before/after sets and every during photo. Six cards is a page
// budget, not an evidence limit; long captions may flow onto another sheet.
function photoPages(item) {
  const entries = [];
  for (let i = 0; i < Math.max(item.before.length, item.after.length); i++) {
    for (const phase of ["before", "after"]) {
      if (item[phase][i]) entries.push({ photo: item[phase][i], phase });
    }
  }
  entries.push(...item.during.map(photo => ({ photo, phase: "during" })));
  const limit = item.label.length > 36 ? 2 : entries.some(({photo}) => (photo.caption || "").length > 60) ? 4 : 6;
  const pages = [];
  for (let i = 0; i < entries.length; i += limit) pages.push(entries.slice(i, i + limit));
  return pages;
}

function recordText(item) {
  if (item.status === "recorded") return item.note || (item.during.length ? "청소 작업 과정과 현장 사진을 안내드립니다." : "등록된 현장 사진을 안내드립니다.");
  return [Core.statusLabel(item.status), item.detail, item.note].filter(Boolean).join(" · ");
}

function createOwnerReportHtml(report, options = {}) {
  const company = options.company && typeof options.company === "object" ? options.company : {};
  const images = options.images && typeof options.images === "object" ? options.images : {};
  const items = report.items.filter(item => item.status !== "recorded" || count(item) || item.note);
  const date = report.workDate || "날짜 미기재";
  const kind = Core.kindLabel(report.kind);
  const footer = () => `<footer class="report-footer"><span><b>BRING CARE</b> · ${escape(company.businessName || "브링케어")}</span><span>수신(건물주) ${escape(report.ownerName || "건물주")}</span></footer>`;
  const header = (title, continuation = "") => `<header class="head"><div><span class="brand">BRING CARE</span><h1>${escape(title)}</h1><p class="sub">${escape(report.buildingName || "건물 미기재")} · ${escape(kind)}</p></div><div class="meta"><b>건물주 제출용</b>작업일 ${escape(date)}${continuation ? `<small>${escape(continuation)}</small>` : ""}</div></header>`;
  const facts = [
    ["작업일", date], ["작업 구분", Core.categoryLabel(report.category) + (report.category === "etc" && report.categoryEtc ? ` · ${report.categoryEtc}` : "")],
    ["작업 범위", report.area], ["담당자", report.workerName], ["현장 주소", report.siteAddress, true],
  ].filter(([, value]) => value).map(([label, value, wide]) => `<div${wide ? ' class="wide"' : ""}><span>${label}</span><b>${escape(value)}</b></div>`).join("");
  const stats = [["작업 구역", `${items.length}곳`], ...Object.entries(PHASES).map(([phase, label]) => [label, `${items.reduce((n, item) => n + item[phase].length, 0)}장`])];
  const photoSheets = items.flatMap(item => {
    const pages = photoPages(item);
    const totals = Object.entries(PHASES).map(([phase, label]) => `${label} · 총 ${item[phase].length}장`).join(" / ");
    return pages.map((entries, index) => `<section class="photo-page ${entries.length > 4 ? "six" : "four"}${entries.some(({photo}) => (photo.caption || "").length > 60) ? " long-captions" : ""}">
      ${header(item.label, pages.length > 1 ? `사진 ${index + 1}/${pages.length}` : "현장 사진")}
      <section class="photo-intro"><h2>구역별 현장 사진</h2><p>${escape(totals)}</p></section>
      <div class="evidence-grid">${entries.map(({ photo, phase }) => {
        const source = images[photo.id];
        // Accept only embedded raster images. No remote URLs, SVG or file paths.
        const safe = typeof source === "string" && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(source);
        return `<figure><div class="photo-bar"><b>${PHASES[phase]}</b><span>작업일 ${escape(date)}</span></div>${safe ? `<img src="${escape(source)}" alt="${escape(`${item.label} · ${PHASES[phase]}`)}">` : '<div class="missing-photo">사진 없음</div>'}<figcaption><b>${escape(item.label)} · ${PHASES[phase]}</b>${photo.caption ? `<span>${escape(photo.caption)}</span>` : ""}</figcaption></figure>`;
      }).join("")}</div>${footer()}
    </section>`);
  }).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>작업 결과 보고서</title><style>
@page{size:A4 portrait;margin:12mm}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#193e53;font-family:"Malgun Gothic","맑은 고딕",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{width:186mm;font-size:9pt;line-height:1.65;overflow-wrap:anywhere}h1,h2,p{margin:0}h2{font-size:11.5pt;color:#214d65;margin-bottom:2mm;break-after:avoid}p{orphans:2;widows:2}
.overview>header,.overview>section,.overview>p{margin-bottom:3.5mm}
.head{display:flex;align-items:center;justify-content:space-between;gap:5mm;background:#eaf6fd;border-top:1mm solid #80cdec;padding:5mm;break-inside:avoid}
.head>div:first-child{min-width:0;flex:1}.head h1{font-size:22pt;line-height:1.35;letter-spacing:-.02em}.brand{display:block;margin-bottom:2.5mm;color:#148cc1;font-size:8.5pt;font-weight:800;letter-spacing:.18em}.sub{margin-top:1.5mm;color:#456f87;font-size:10pt}
.meta{text-align:right;flex:0 0 36mm;font-size:8pt;color:#456f87}.meta b,.meta small{display:block}.meta small{margin-top:2mm;font-size:7.5pt}
.greeting{font-size:9.5pt;line-height:1.85;color:#45677b;white-space:pre-wrap}
.monthly-summary{padding:4mm 5mm;background:#f3faff;border-left:1mm solid #83cde9;box-decoration-break:clone}.monthly-summary .greeting{font-size:10pt;color:#34586e}
.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:7mm;border-top:.3mm solid #d8eaf4}.facts>div{display:flex;align-items:baseline;gap:3mm;padding:2.5mm 0;border-bottom:.2mm solid #e8f1f6;break-inside:avoid}.facts .wide{grid-column:span 2}.facts span{flex:0 0 18mm;color:#6a8190;font-size:8pt}.facts b{font-weight:500;color:#244b62;white-space:pre-wrap;min-width:0}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:3mm;break-inside:avoid}.stat{padding:3mm;border:1px solid #d8eaf4;background:#f4fbff;border-radius:1.5mm;text-align:center}.stat span{display:block;color:#6a8190;font-size:8pt}.stat b{display:block;font-size:15pt;color:#214d65}
.areas{width:100%;border-collapse:collapse;table-layout:fixed}.areas th,.areas td{border-bottom:.2mm solid #d8eaf4;padding:3mm 2mm;font-size:8.5pt;vertical-align:top;text-align:left;white-space:pre-wrap}.areas th{background:#eaf6fd;color:#386f8a;font-size:8pt}.areas th:first-child{width:32mm}.areas th:last-child{width:22mm}.areas td:last-child{text-align:center}.areas thead{display:table-header-group}.areas tr{break-inside:avoid}
.follow{padding:3.5mm 4mm;background:#f6fafc;border-top:.25mm solid #d8eaf4;box-decoration-break:clone}.follow p{white-space:pre-wrap;color:#567486;font-size:8.7pt}
.notices{font-size:7pt;line-height:1.65;color:#7c92a0}.notices p{margin-bottom:1mm}.document-no{font-size:7pt;color:#7c92a0}
.report-footer{display:flex;justify-content:space-between;gap:5mm;border-top:.25mm solid #d8eaf4;padding-top:2.5mm;margin-top:5mm;color:#6a8190;font-size:7.5pt;break-inside:avoid}.report-footer b{color:#148cc1}
.photo-page{break-before:page}.photo-page .head{margin-bottom:5mm}.photo-intro{margin-bottom:4mm;break-after:avoid}.photo-intro p{color:#638399;font-size:8pt}
.overview .head{padding:4mm 5mm}.overview .facts>div{padding:2mm 0}.overview .stat{padding:2.5mm}.overview .areas th,.overview .areas td{padding:2.5mm 2mm}.overview .report-footer{margin-top:3mm}
.evidence-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4mm}.evidence-grid figure{margin:0;border:.25mm solid #d8eaf4;background:#fff;break-inside:avoid;min-width:0}.photo-bar{display:flex;justify-content:space-between;gap:2mm;padding:2mm 3mm;background:#eaf6fd;color:#456f87;font-size:7.5pt;break-after:avoid}.photo-bar b{color:#087fae;font-size:8pt}
.evidence-grid img,.missing-photo{display:block;width:100%;height:72mm;object-fit:contain;background:#f4f9fc}.missing-photo{display:grid;place-items:center;color:#8b95a1;font-size:8pt}.evidence-grid figcaption{padding:2mm 3mm;color:#49697d;font-size:7.5pt;line-height:1.5;white-space:pre-wrap}.evidence-grid figcaption b{font-weight:600;display:block}.evidence-grid figcaption span{display:block;color:#6a8190;font-size:7pt;margin-top:1mm}.six .evidence-grid{gap:3mm}.six img,.six .missing-photo{height:42mm}
.long-captions img,.long-captions .missing-photo{height:60mm}
</style></head><body><main>
<section class="overview">${header("작업 결과보고서")}
<p class="greeting">${escape(report.ownerName || "건물주")}님, ${escape(date)} ${escape(report.buildingName || "현장")}의 ${escape(kind)} 기록을 안내드립니다.</p>
<section class="monthly-summary"><h2>이번 작업 요약</h2><p class="greeting">${escape(report.summary || "구역별 현장 기록을 정리했습니다. 등록된 작업 내용과 사진은 아래에서 확인하실 수 있습니다.")}</p></section>
<section><h2>작업 정보</h2><div class="facts">${facts}</div></section>
<section><h2>사진 기록 요약</h2><div class="stats">${stats.map(([label, value]) => `<div class="stat"><span>${label}</span><b>${value}</b></div>`).join("")}</div></section>
<section><h2>구역별 작업 기록</h2>${items.length ? `<table class="areas"><thead><tr><th>작업 구역</th><th>보고 내용</th><th>현장 사진</th></tr></thead><tbody>${items.map(item => `<tr><td>${escape(item.label)}</td><td>${escape(recordText(item))}</td><td>${count(item)}장</td></tr>`).join("")}</tbody></table>` : '<p class="greeting">등록된 작업 기록이 없습니다.</p>'}</section>
<section class="follow"><h2>추가 안내</h2><p>${escape(report.followUp || "등록된 후속 조치 사항은 없습니다. 궁금하신 점이나 추가로 살펴볼 부분은 브링케어로 말씀해 주세요.")}</p></section>
<section class="notices">${Core.NOTICES.map(line => `<p>· ${escape(line)}</p>`).join("")}</section>
<p class="document-no">문서번호 ${escape(Core.documentNo(report))}</p>${footer()}</section>
${photoSheets}</main></body></html>`;
}

module.exports = { createOwnerReportHtml, photoPages };
