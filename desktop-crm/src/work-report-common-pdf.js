"use strict";
// 공용부 청소 보고서: '공용부 활동 결과보고서' 양식(공용부_활동결과보고서_양식.hwpx)을
// 그대로 옮긴 PDF. 표지 → Ⅰ 현장 기록 개요 → Ⅱ 현장 사진 기록(한 쪽에 3×3) 순서다.
// 공용부는 작업 전 사진을 찍지 않으므로 단계(전·중·후)를 나누지 않고 사진 번호와 구역만 단다.
// 예전 보고서에 남아 있는 작업 전·중 사진도 빠뜨리지 않고 같은 순서 규칙으로 싣는다.
const Owner = require("./work-report-owner-pdf");

const { escape, SAFE_IMAGE, FONT_STACK } = Owner;
const PER_PAGE = 9;
const BLUE = "#0C58A0";

const pad = n => String(n).padStart(2, "0");
// 양식 표기 "2026. 11. 09." 로 쓴다. 저장값은 2026-11-09 형식이다.
const formDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? `${value.slice(0, 4)}. ${value.slice(5, 7)}. ${value.slice(8, 10)}.` : "";
// 사진 번호 목록을 "1–4, 7" 처럼 줄인다.
function numberRanges(numbers) {
  const out = [];
  for (let i = 0; i < numbers.length; i++) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j++;
    out.push(j > i ? `${numbers[i]}–${numbers[j]}` : String(numbers[i]));
    i = j;
  }
  return out.join(", ");
}

// 구역 순서(카탈로그 순서) 안에서 찍은 순서대로 번호를 매긴다.
function numberedPhotos(items) {
  const photos = [];
  for (const item of items) {
    for (const photo of [...item.before, ...item.during, ...item.after]) photos.push({ photo, item, n: photos.length + 1 });
  }
  return photos;
}

function sectionHead(numeral, title, side) {
  return `<table class="sec"><tbody><tr><td class="sec-no">${numeral}</td><td class="sec-title">${escape(title)}</td>${side ? `<td class="sec-side">${escape(side)}</td>` : ""}</tr></tbody></table>`;
}

// 사진 한 장 = 위 칸(번호·구역) + 아래 칸(사진). 원본 비율 그대로 넣고 자르지 않는다.
function photoCell(entry, images) {
  const source = images[entry.photo.id];
  // Accept only embedded raster images. No remote URLs, SVG or file paths.
  const safe = typeof source === "string" && SAFE_IMAGE.test(source);
  const label = `사진 ${pad(entry.n)}`;
  return {
    caption: `<td class="cap">${label}&nbsp;&nbsp;|&nbsp;&nbsp;<b>${escape(entry.item.label)}</b></td>`,
    picture: `<td class="pic"><div>${safe ? `<img src="${escape(source)}" alt="${escape(`${label} · ${entry.item.label}`)}">` : '<span class="missing">사진 없음</span>'}</div></td>`,
  };
}

function photoPage(entries, index, total, date, images) {
  const first = index * PER_PAGE + 1;
  const last = first + entries.length - 1;
  const rows = [];
  for (let r = 0; r < entries.length; r += 3) {
    const row = entries.slice(r, r + 3).map(entry => photoCell(entry, images));
    rows.push(`<tr>${row.map(cell => cell.caption).join("")}</tr><tr class="pics">${row.map(cell => cell.picture).join("")}</tr>`);
  }
  const title = index ? "현장 사진 기록 (계속)" : "현장 사진 기록";
  const range = first === last ? `사진 ${first}` : `사진 ${first}–${last}`;
  return `<section class="photo-page">${sectionHead("Ⅱ", title, `촬영일: ${date}  /  ${range}`)}
<table class="grid"><colgroup><col><col><col></colgroup><tbody>${rows.join("")}</tbody></table>${index === total - 1 ? '<p class="end">- 이 상 -</p>' : ""}</section>`;
}

function styles() {
  return `@page{size:A4 portrait;margin:15mm 20mm}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:${FONT_STACK};-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{width:170mm;font-size:10pt;line-height:1.55;overflow-wrap:anywhere}p,h1,h2,h3{margin:0}
table{border-collapse:collapse;width:100%;table-layout:fixed}
.cover{height:267mm;display:flex;flex-direction:column;justify-content:center;align-items:center;break-after:page;text-align:center}
.cover-band{width:100%;margin-top:40mm;border-top:.5mm solid ${BLUE};border-bottom:.5mm solid ${BLUE};padding:6mm 0}
.cover-band h1{font-size:28pt;font-weight:800;letter-spacing:.02em}
.cover-site{font-size:16pt;margin-top:5mm}.cover-date{font-size:12pt;margin-top:1.5mm}
.cover-brand{margin-top:auto;margin-bottom:20mm;display:flex;flex-direction:column;align-items:center;gap:3mm}
.cover-brand img{height:9mm}.cover-brand b{font-size:15pt}
.top-bar{display:flex;height:1mm;margin-bottom:4mm}.top-bar i{display:block;background:${BLUE};flex:34}.top-bar i+i{background:#B6CDE3;flex:14.2}
.doc-title{font-size:19pt;font-weight:800;margin-bottom:6mm}
.sec{margin:0 0 4mm}.sec td{background:#F2F2F2;font-size:14pt;font-weight:700;padding:1.6mm 3mm;vertical-align:middle}
.sec .sec-no{width:13mm;background:${BLUE};color:#fff;text-align:center;padding:1.6mm 0}
.sec .sec-side{width:72mm;font-size:9.5pt;font-weight:400;text-align:right;white-space:nowrap}
h3{font-size:12pt;font-weight:700;margin:5mm 0 2mm}
.info td,.info th,.zones td,.zones th{border:.12mm solid #BFBFBF;padding:1.4mm 2.5mm;font-size:10pt;vertical-align:middle}
.info th,.zones th,.zones tfoot td{background:#E2EBF5;font-weight:700;text-align:center}
.info th{width:49.4mm}.zones td{text-align:center}.zones td:first-child{text-align:center}
.zones .c1{width:42.3mm}.zones .c2{width:24.7mm}
.notes p{padding-left:4mm;text-indent:-4mm;margin:.8mm 0}
.overview{break-after:page}
.photo-page{break-before:page}.photo-page:first-of-type{break-before:auto}
.grid td{border:.12mm solid #BFBFBF;width:33.333%}
.grid .cap{background:#E2EBF5;font-size:9.5pt;text-align:center;padding:.9mm 1mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.grid .pic{height:67mm;padding:1mm;text-align:center;vertical-align:middle}
.grid .pic div{height:65mm;display:flex;align-items:center;justify-content:center}
.grid .pic img{max-width:100%;max-height:65mm;object-fit:contain}
.grid tr{break-inside:avoid}.missing{color:#888;font-size:9pt}
.end{text-align:center;margin-top:6mm;font-size:10pt}`;
}

function createCommonActivityReportHtml(report, options = {}) {
  const images = options.images && typeof options.images === "object" ? options.images : {};
  const count = item => item.before.length + item.during.length + item.after.length;
  // 고른 구역은 사진이 없어도 표에 남긴다(현장앱 includeEmptyAreas). 아니면 사진·메모가 있는 구역만.
  const items = report.items.filter(item => options.includeEmptyAreas || count(item) || item.note);
  const photos = numberedPhotos(items);
  const date = formDate(report.workDate) || "날짜 미기재";
  // 고객 단위 보고서(건물 미연결)는 buildingName 에 CRM 고객 이름이 들어 있다. 실명·별명이
  // 건물주용 문서에 나가지 않게 연결된 건물이 있을 때만 건물명을, 아니면 현장 주소를 쓴다.
  const site = (report.buildingId && report.buildingName) || report.siteAddress || "현장";
  const sender = (options.company && options.company.businessName) || "브링케어";
  const logo = Owner.ownerLogo();
  const byItem = new Map(items.map(item => [item, photos.filter(entry => entry.item === item).map(entry => entry.n)]));
  const pages = [];
  for (let i = 0; i < photos.length; i += PER_PAGE) pages.push(photos.slice(i, i + PER_PAGE));
  const targets = items.map(item => item.label).join("·") || "-";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><title>공용부 활동 결과보고서</title><style>
${Owner.ownerFontFace()}
${styles()}
</style></head><body><main>
<section class="cover"><div class="cover-band"><h1>공용부 활동 결과보고서</h1></div>
<p class="cover-site">${escape(site)}</p><p class="cover-date">${escape(date)}</p>
<div class="cover-brand">${logo ? `<img src="${logo}" alt="Bring Care">` : ""}<b>${escape(sender)}</b></div></section>
<section class="overview">
<div class="top-bar"><i></i><i></i></div>
<h2 class="doc-title">공용부 활동 결과보고서</h2>
${sectionHead("Ⅰ", "공용부 현장 기록 개요")}
<h3>1. 현장 기본정보</h3>
<table class="info"><tbody>
<tr><th>현장명</th><td>${escape(site)}</td></tr>
<tr><th>촬영일</th><td>${escape(date)}</td></tr>
<tr><th>사진 수</th><td>${photos.length}장</td></tr>
<tr><th>대상</th><td>${escape(targets)}</td></tr>
</tbody></table>
<h3>2. 사진 확인 범위 및 안내</h3>
<div class="notes">
<p>○ 제공된 사진을 구역별로 촬영 순서대로 표 안에 정리했습니다.</p>
<p>○ 사진은 현장 상태 기록이며 청소 완료 여부나 설비의 작동·안전 상태를 증명하지 않습니다.</p>
<p>○ 촬영일은 보고서에 등록된 작업일 기준입니다. 작업일과 결과는 별도 확인이 필요합니다.</p>
</div>
<h3>3. 구역별 사진 현황</h3>
<table class="zones"><thead><tr><th class="c1">구역</th><th class="c2">사진 수</th><th>사진 번호</th></tr></thead><tbody>
${items.map(item => { const numbers = byItem.get(item); return `<tr><td>${escape(item.label)}</td><td>${numbers.length || "-"}</td><td>${numbers.length ? numberRanges(numbers) : "-"}</td></tr>`; }).join("")}
</tbody><tfoot><tr><td>합계</td><td>${photos.length}</td><td></td></tr></tfoot></table>
${pages.length ? "" : '<p class="end">- 이 상 -</p>'}
</section>
${pages.map((entries, index) => photoPage(entries, index, pages.length, date, images)).join("\n")}
</main></body></html>`;
}

module.exports = { createCommonActivityReportHtml, numberRanges, PER_PAGE };
