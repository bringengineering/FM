"use strict";
// 결과보고서 표준 양식: '공용부 활동 결과보고서' 양식(공용부_활동결과보고서_양식.hwpx)을
// 그대로 옮긴 PDF. 표지 → Ⅰ 현장 기록 개요 → Ⅱ 현장 사진 기록(한 쪽에 3×3) 순서다.
// 2026-11-13 부터 모든 작업 종류(유지보수·수리, 입주·퇴실청소 등)와 세입자 안내문도 이 양식으로 낸다.
// 공용부는 작업 전 사진을 찍지 않으므로 단계(전·중·후)를 나누지 않고 사진 번호와 구역만 단다.
// 예전 보고서에 남아 있는 작업 전·중 사진도 빠뜨리지 않고 같은 순서 규칙으로 싣는다.
const Owner = require("./work-report-owner-pdf");
const Core = require("./work-report-core");

const { escape, SAFE_IMAGE, FONT_STACK } = Owner;
const PER_PAGE = 9;
const BLUE = "#0C58A0";

// 같은 양식을 쓰는 종류별 문구. 폐기물 처리도 이 양식으로 낸다(2026-11).
const VARIANTS = Object.freeze({
  common: Object.freeze({
    title: "공용부 활동 결과보고서",
    overview: "공용부 현장 기록 개요",
    zone: "구역",
    notes: Object.freeze([
      "제공된 사진을 구역별로 촬영 순서대로 표 안에 정리했습니다.",
      "사진은 현장 상태 기록이며 청소 완료 여부나 설비의 작동·안전 상태를 증명하지 않습니다.",
      "촬영일은 보고서에 등록된 작업일 기준입니다. 작업일과 결과는 별도 확인이 필요합니다.",
    ]),
  }),
  waste: Object.freeze({
    title: "폐기물 처리 활동 결과보고서",
    overview: "폐기물 처리 현장 기록 개요",
    zone: "항목",
    notes: Object.freeze([
      "제공된 사진을 항목별로 촬영 순서대로 표 안에 정리했습니다.",
      "사진은 촬영 시점의 현장 상태 기록이며 지자체 수거 완료 여부를 증명하지 않습니다.",
      "촬영일은 보고서에 등록된 작업일 기준입니다. 수거 일정과 결과는 별도 확인이 필요합니다.",
    ]),
  }),
  repair: Object.freeze({
    title: "유지보수·수리 결과보고서",
    overview: "유지보수·수리 현장 기록 개요",
    zone: "항목",
    notes: Object.freeze([
      "제공된 사진을 항목별로 작업 전·중·후 순서대로 표 안에 정리했습니다.",
      "사진은 작업 당시 현장 상태 기록이며 시공 품질이나 하자 없음을 보증하지 않습니다.",
      "작업일은 보고서에 등록된 날짜 기준입니다.",
    ]),
  }),
});
// 따로 문구를 정하지 않은 종류(입주·퇴실청소, 계단청소 등)는 종류 이름으로 같은 양식을 쓴다.
function variantFor(kind) {
  if (VARIANTS[kind]) return VARIANTS[kind];
  const label = Core.kindLabel(kind) || "작업";
  return {
    title: `${label} 결과보고서`,
    overview: `${label} 현장 기록 개요`,
    zone: "구역",
    notes: [
      "제공된 사진을 구역별로 작업 전·중·후 순서대로 표 안에 정리했습니다.",
      "사진은 작업 당시 현장 상태 기록이며 설비의 작동·안전 상태를 증명하지 않습니다.",
      "작업일은 보고서에 등록된 날짜 기준입니다.",
    ],
  };
}
// 세입자 안내문. 건물주 이름·연락처, 비용·자재, 후속 사항은 싣지 않는다.
const TENANT = Object.freeze({
  title: "작업 완료 안내문",
  overview: "작업 개요",
  zone: "항목",
  notes: Object.freeze([
    "작업한 부분의 사진을 항목별로 작업 순서대로 정리했습니다.",
    "생활하시면서 불편한 점이 있으면 사진을 찍어 브링케어(1551-3873)로 알려 주세요.",
  ]),
});
const PHASE_LABEL = Object.freeze({ before: "작업 전", during: "작업 중", after: "작업 후" });

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
    for (const phase of ["before", "during", "after"]) for (const photo of item[phase]) photos.push({ photo, item, phase, n: photos.length + 1 });
  }
  return photos;
}

function sectionHead(numeral, title, side) {
  return `<table class="sec"><tbody><tr><td class="sec-no">${numeral}</td><td class="sec-title">${escape(title)}</td>${side ? `<td class="sec-side">${escape(side)}</td>` : ""}</tr></tbody></table>`;
}

// 사진 한 장 = 위 칸(번호·구역) + 아래 칸(사진). 원본 비율 그대로 넣고 자르지 않는다.
function photoCell(entry, images, showPhase) {
  const source = images[entry.photo.id];
  // Accept only embedded raster images. No remote URLs, SVG or file paths.
  const safe = typeof source === "string" && SAFE_IMAGE.test(source);
  const label = `사진 ${pad(entry.n)}`;
  return {
    caption: `<td class="cap">${label}&nbsp;&nbsp;|&nbsp;&nbsp;<b>${escape(entry.item.label)}</b>${showPhase ? ` · ${PHASE_LABEL[entry.phase]}` : ""}</td>`,
    picture: `<td class="pic"><div>${safe ? `<img src="${escape(source)}" alt="${escape(`${label} · ${entry.item.label}`)}">` : '<span class="missing">사진 없음</span>'}</div></td>`,
  };
}

function photoPage(entries, index, total, date, images, showPhase, dateLabel) {
  const first = index * PER_PAGE + 1;
  const last = first + entries.length - 1;
  const rows = [];
  for (let r = 0; r < entries.length; r += 3) {
    const row = entries.slice(r, r + 3).map(entry => photoCell(entry, images, showPhase));
    rows.push(`<tr>${row.map(cell => cell.caption).join("")}</tr><tr class="pics">${row.map(cell => cell.picture).join("")}</tr>`);
  }
  const title = index ? "현장 사진 기록 (계속)" : "현장 사진 기록";
  const range = first === last ? `사진 ${first}` : `사진 ${first}–${last}`;
  return `<section class="photo-page">${sectionHead("Ⅱ", title, `${dateLabel}: ${date}  /  ${range}`)}
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
.end{text-align:center;margin-top:6mm;font-size:10pt}
.prose{white-space:pre-wrap;font-size:10pt;line-height:1.7;border:.12mm solid #BFBFBF;padding:3mm 4mm;background:#FAFBFD}`;
}

function createCommonActivityReportHtml(report, options = {}) {
  const images = options.images && typeof options.images === "object" ? options.images : {};
  const count = item => item.before.length + item.during.length + item.after.length;
  // 고른 구역은 사진이 없어도 표에 남긴다(현장앱 includeEmptyAreas). 아니면 사진·메모가 있거나
  // 상태(완료·일부·못 함)를 정한 구역만.
  const items = report.items.filter(item => options.includeEmptyAreas || item.status !== "recorded" || count(item) || item.note);
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
  const tenant = options.audience === "tenant";
  const v = tenant ? TENANT : variantFor(report.kind);
  // 공용부·폐기물은 원래 양식대로 사진에 단계(전·중·후)를 달지 않는다. 나머지는 단다.
  const legacyForm = !tenant && (report.kind === "common" || report.kind === "waste");
  const dateLabel = legacyForm ? "촬영일" : "작업일";
  const unit = String(report.tenantUnit || "").trim().replace(/호$/u, "");
  const coverSite = tenant && unit && !site.includes(`${unit}호`) ? `${site} ${unit}호` : site;
  // 양식의 1·2·3 뒤에 받는 사람별 칸을 이어 붙인다. 번호는 실린 것만 센다.
  const blocks = [];
  if (tenant) {
    blocks.push(["작업 안내", `<p class="prose">${escape(report.tenantSummary || "작업 내용과 현장 사진을 정리해 안내드립니다.")}</p>`]);
  } else if (!legacyForm && report.summary) {
    blocks.push(["작업 내용", `<p class="prose">${escape(report.summary)}</p>`]);
  }
  blocks.push(["사진 확인 범위 및 안내", `<div class="notes">${v.notes.map(note => `<p>○ ${escape(note)}</p>`).join("")}</div>`]);
  const zoneTable = `<table class="zones"><thead><tr><th class="c1">${v.zone}</th><th class="c2">사진 수</th><th>사진 번호</th></tr></thead><tbody>
${items.map(item => { const numbers = byItem.get(item); return `<tr><td>${escape(item.label)}</td><td>${numbers.length || "-"}</td><td>${numbers.length ? numberRanges(numbers) : "-"}</td></tr>`; }).join("")}
</tbody><tfoot><tr><td>합계</td><td>${photos.length}</td><td></td></tr></tfoot></table>`;
  blocks.push([`${v.zone}별 사진 현황`, zoneTable]);
  if (tenant) blocks.push(["생활 안내", `<p class="prose">${escape(report.tenantGuide || Core.tenantGuideFor(report.kind, items))}</p>`]);
  else if (!legacyForm) {
    if (report.ownerNote) blocks.push(["비용·자재", `<p class="prose">${escape(report.ownerNote)}</p>`]);
    if (report.followUp) blocks.push(["후속 조치·권고", `<p class="prose">${escape(report.followUp)}</p>`]);
  }
  const infoRows = [["현장명", coverSite], [dateLabel, date], ["사진 수", `${photos.length}장`], ["대상", targets]];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><title>${escape(v.title)}</title><style>
${Owner.ownerFontFace()}
${styles()}
</style></head><body><main>
<section class="cover"><div class="cover-band"><h1>${escape(v.title)}</h1></div>
<p class="cover-site">${escape(coverSite)}</p><p class="cover-date">${escape(date)}</p>
<div class="cover-brand">${logo ? `<img src="${logo}" alt="Bring Care">` : ""}<b>${escape(sender)}</b></div></section>
<section class="overview">
<div class="top-bar"><i></i><i></i></div>
<h2 class="doc-title">${escape(v.title)}</h2>
${sectionHead("Ⅰ", v.overview)}
<h3>1. 현장 기본정보</h3>
<table class="info"><tbody>
${infoRows.map(([label, value]) => `<tr><th>${escape(label)}</th><td>${escape(value)}</td></tr>`).join("")}
</tbody></table>
${blocks.map(([title, body], i) => `<h3>${i + 2}. ${escape(title)}</h3>\n${body}`).join("\n")}
${pages.length ? "" : '<p class="end">- 이 상 -</p>'}
</section>
${pages.map((entries, index) => photoPage(entries, index, pages.length, date, images, !legacyForm, dateLabel)).join("\n")}
</main></body></html>`;
}

module.exports = { createCommonActivityReportHtml, numberRanges, PER_PAGE, VARIANTS };
