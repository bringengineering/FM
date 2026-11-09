"use strict";
const fs = require("node:fs");
const path = require("node:path");
const CustomerCore = require("./core");

const Core = require("./work-report-core");
const PHASES = { before: "작업 전", during: "작업 중", after: "작업 후" };
const PHASE_EN = { before: "BEFORE", during: "DURING", after: "AFTER" };
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);
const count = item => item.before.length + item.during.length + item.after.length;
const SAFE_IMAGE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/;

// 건물주에게 나가는 공식 문서라 회사 로고를 넣는다. JPEG 로 둔다 — 인감 PNG 가
// 보고서에 섞이지 않았는지 보는 검사(data:image/png)를 로고가 흐리면 안 된다. 렌더러는 data: 이미지만
// 허용하므로 파일을 읽어 박는다. 없으면 글자 상표로 대신한다 — 보고서가
// 로고 때문에 못 나가면 안 된다.
const LOGO = (() => {
  try {
    const bytes = fs.readFileSync(path.join(__dirname, "assets", "bring-care-logo.jpg"));
    return bytes.length && bytes.length < 512 * 1024 ? `data:image/jpeg;base64,${bytes.toString("base64")}` : "";
  } catch { return ""; }
})();

// 본문 글꼴은 Pretendard(SIL OFL 1.1, assets/fonts/Pretendard-LICENSE.txt).
// 렌더러는 외부 파일을 불러오지 않으므로 가변 글꼴 하나를 data: 로 박는다.
// 파일이 없으면 기존 시스템 글꼴로 그대로 출력한다.
const PRETENDARD = (() => {
  try {
    const bytes = fs.readFileSync(path.join(__dirname, "assets", "fonts", "PretendardVariable.woff2"));
    return bytes.length && bytes.length < 4 * 1024 * 1024 ? `data:font/woff2;base64,${bytes.toString("base64")}` : "";
  } catch { return ""; }
})();
const FONT_STACK = '"Pretendard","Malgun Gothic","맑은 고딕","Apple SD Gothic Neo","Noto Sans KR",sans-serif';

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

// 사람이 적은 메모가 있으면 그것을, 없으면 그 구역의 표준 수행범위를 쓴다.
// "등록된 현장 사진을 안내드립니다" 를 구역마다 반복하면 무엇을 했는지 알 수 없다.
function recordText(item) {
  if (item.status === "recorded") return item.note || item.detail || "현장 사진 기록";
  return [Core.statusLabel(item.status), item.detail, item.note].filter(Boolean).join(" · ");
}

function photoCounts(item, long = false) {
  return ["before", "during", "after"].filter(phase => item[phase].length)
    .map(phase => long ? `${PHASES[phase]} · 총 ${item[phase].length}장` : `${PHASES[phase]} ${item[phase].length}장`).join(long ? " / " : " · ") || "사진 없음";
}

// 사진 한 장. 같은 크기의 회색 액자에 원본 비율 그대로(잘라내지 않고) 넣고,
// 아래에 단계 꼬리표와 사람이 적은 설명만 단다. 구역 이름은 구역 머리에 한 번만 쓴다.
function figure(item, photo, phase, number, images) {
  const source = images[photo.id];
  // Accept only embedded raster images. No remote URLs, SVG or file paths.
  const safe = typeof source === "string" && SAFE_IMAGE.test(source);
  const tag = number ? `${PHASES[phase]} ${number}` : PHASES[phase];
  return `<figure class="shot ${phase}"><div class="frame">${safe ? `<img src="${escape(source)}" alt="${escape(`${item.label} · ${tag}`)}">` : '<div class="missing-photo">사진 없음</div>'}</div><figcaption><b class="tag">${tag}</b>${photo.caption ? `<span>${escape(photo.caption)}</span>` : ""}</figcaption></figure>`;
}

// 짝이 없는 사진과 작업 중 사진은 단계별로 세 칸씩 작게 모아 싣는다.
function photoGrid(item, entries, images) {
  return `<div class="shots">${entries.map(entry => figure(item, entry.photo, entry.phase, entry.n, images)).join("")}</div>`;
}
// 같은 장소로 확인된 짝(pairId 가 같은 작업 전·후)은 앞에 나란히 놓는다. 짝 표시가
// 하나도 없는 예전 보고서만 장수가 같을 때 순서대로 짝짓는다. 나머지는 단계별로 싣는다.
function areaPairs(item) {
  const hasPairIds = [...item.before, ...item.after].some(photo => photo.pairId);
  if (!hasPairIds) {
    const equal = item.before.length > 0 && item.before.length === item.after.length;
    return { pairs: equal ? item.before.map((photo, i) => [photo, item.after[i]]) : [], before: equal ? [] : item.before, after: equal ? [] : item.after };
  }
  const afterByPair = new Map(item.after.filter(photo => photo.pairId).map(photo => [photo.pairId, photo]));
  const pairs = [], usedAfter = new Set();
  for (const photo of item.before) {
    const match = photo.pairId && afterByPair.get(photo.pairId);
    if (match && !usedAfter.has(match)) { pairs.push([photo, match]); usedAfter.add(match); }
  }
  const pairedBefore = new Set(pairs.map(pair => pair[0]));
  return { pairs, before: item.before.filter(photo => !pairedBefore.has(photo)), after: item.after.filter(photo => !usedAfter.has(photo)) };
}
function areaPhotos(item, index, images) {
  const { pairs, before, after } = areaPairs(item);
  const rows = pairs.map(([b, a], i) => `<div class="pair"><p class="pair-label">같은 위치 ${i + 1}</p><div class="pair-body">${figure(item, b, "before", 0, images)}<span class="arrow">→</span>${figure(item, a, "after", 0, images)}</div></div>`);
  const rest = { before, after, during: item.during };
  const numbered = phase => rest[phase].map((photo, i) => ({ photo, phase, n: i + 1 }));
  const notes = [];
  if (!item.before.length || !item.after.length) {
    // 전·후 짝을 만들 수 없는 구역. 실제로 있는 단계만 적는다(전+중이면 "작업 전·작업 중").
    const used = ["before", "during", "after"].filter(phase => item[phase].length).map(phase => PHASES[phase]);
    if (used.length) notes.push(`이 구역은 ${used.join("·")} 사진으로 기록했습니다.`);
  }
  else if (!pairs.length) notes.push(`작업 전 ${item.before.length}장과 작업 후 ${item.after.length}장은 같은 장소끼리 짝이 맞지 않아 단계별로 나누어 실었습니다.`);
  else if (before.length || after.length) {
    // 남은 장수가 0인 단계는 적지 않는다("작업 후 0장은 아래에…" 는 없는 사진을 가리킨다).
    const rest = [before.length ? `작업 전 ${before.length}장` : "", after.length ? `작업 후 ${after.length}장` : ""].filter(Boolean).join("·");
    notes.push(`같은 장소로 확인된 ${pairs.length}쌍을 나란히 비교하고, 나머지 ${rest}은 아래에 단계별로 실었습니다.`);
  }
  const section = phase => rest[phase].length ? `<div class="group"><p class="group-head ${phase}">${PHASES[phase]} 사진<small>${rest[phase].length}장</small></p>${photoGrid(item, numbered(phase), images)}</div>` : "";
  return `<section class="area-photos">
    <div class="area-head"><span class="no">${String(index).padStart(2, "0")}</span><h3>${escape(item.label)}</h3><p>${escape(photoCounts(item))}</p></div>
    ${item.detail ? `<p class="area-scope">수행 범위 · ${escape(item.detail)}</p>` : ""}
    ${notes.map(line => `<p class="area-note">${escape(line)}</p>`).join("")}
    ${rows.join("")}
    ${section("before")}${section("after")}${section("during")}
  </section>`;
}

// 건물주에게 나가는 보고서들이 같은 얼굴을 하도록 글꼴·색·사진 카드 양식을 한 곳에 둔다.
// runningTitle 은 둘째 쪽부터 오른쪽 위에 찍히는 문서 이름·번호다.
const ownerFontFace = () => PRETENDARD ? `@font-face{font-family:"Pretendard";src:url(${PRETENDARD}) format("woff2-variations"),url(${PRETENDARD}) format("woff2");font-weight:45 920;font-style:normal;font-display:block}` : "";
function ownerReportStyles(runningTitle) {
  return `${ownerFontFace()}
@page{size:A4 portrait;margin:14mm 12mm 14mm;@top-right{content:"${escape(runningTitle)}";font-family:${FONT_STACK};font-size:7pt;color:#7a8f9c;vertical-align:bottom}@bottom-left{content:"BRING CARE · 건물주 제출용";font-family:${FONT_STACK};font-size:7pt;color:#6a8190;vertical-align:middle}@bottom-right{content:counter(page) " / " counter(pages);font-family:${FONT_STACK};font-size:7pt;color:#6a8190;vertical-align:middle}}
@page:first{@top-right{content:none}}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#1d3b4f;font-family:${FONT_STACK};-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{width:186mm;font-size:9pt;line-height:1.65;overflow-wrap:anywhere}h1,h2,h3,p{margin:0}p{orphans:2;widows:2}
h2{font-size:11pt;color:#1f4e8c;margin:0 0 2mm;padding-left:2.5mm;border-left:1mm solid #80cdec;break-after:avoid}
.overview>section,.overview>p,.overview>header,.overview>table{margin-bottom:4.5mm}
.doc-head{display:flex;align-items:center;justify-content:space-between;gap:6mm;padding-bottom:4mm;border-bottom:.9mm solid #16324a;box-shadow:0 1.2mm 0 -.6mm #80cdec;break-inside:avoid}
.doc-head .brand-logo{height:11mm;width:auto;display:block}.doc-head .brand-text{font-size:13pt;font-weight:800;color:#1f5aa6;letter-spacing:.06em}
.doc-title{text-align:right}.doc-title h1{font-size:21pt;letter-spacing:.12em;color:#16324a;line-height:1.25}.doc-title p{font-size:7.5pt;letter-spacing:.3em;color:#6a8190}
.letter{width:100%;border-collapse:collapse;table-layout:fixed;border-top:.4mm solid #1f4e8c;border-bottom:.3mm solid #b9d3e3}
.letter th,.letter td{padding:2.2mm 3mm;font-size:9pt;text-align:left;vertical-align:top;border-bottom:.2mm solid #d8eaf4}
.letter th{width:24mm;background:#eaf6fd;color:#1f4e8c;font-weight:700}
.greeting{font-size:9.5pt;line-height:1.85;color:#2f5164;white-space:pre-wrap}
.monthly-summary{padding:4mm 5mm;background:#f3faff;border:.25mm solid #d8eaf4;border-left:1mm solid #80cdec;box-decoration-break:clone}.monthly-summary h2{border:0;padding:0}.monthly-summary .greeting{color:#34586e}
.facts{width:100%;border-collapse:collapse;table-layout:fixed}.facts th,.facts td{padding:2mm 3mm;border:.2mm solid #d8eaf4;font-size:8.7pt;text-align:left;vertical-align:top}.facts th{width:22mm;background:#eaf6fd;color:#386f8a;font-weight:700}
.stats{display:flex;gap:3mm;break-inside:avoid}.stat{flex:1;padding:2.5mm;border:.25mm solid #d8eaf4;background:#f4fbff;border-radius:1.5mm;text-align:center}.stat span{display:block;color:#6a8190;font-size:8pt}.stat b{display:block;font-size:14pt;color:#1f4e8c}
.areas{width:100%;border-collapse:collapse;table-layout:fixed}.areas th,.areas td{border-bottom:.2mm solid #d8eaf4;padding:2.5mm 2mm;font-size:8.5pt;vertical-align:top;text-align:left;white-space:pre-wrap}.areas th{background:#eaf6fd;color:#386f8a;font-size:8pt}.areas th:first-child{width:9mm;text-align:center}.areas td:first-child{text-align:center;color:#6a8190}.areas th:nth-child(2){width:30mm}.areas th:last-child{width:34mm}.areas thead{display:table-header-group}.areas tr{break-inside:avoid}
.follow{padding:3.5mm 4mm;background:#f6fafc;border-top:.25mm solid #d8eaf4;box-decoration-break:clone}.follow p{white-space:pre-wrap;color:#4b6b7e;font-size:8.7pt}
.notices{font-size:7pt;line-height:1.65;color:#7c92a0}.notices p{margin-bottom:.8mm}
.sender{display:flex;justify-content:space-between;align-items:flex-end;gap:6mm;padding-top:4mm;border-top:.3mm solid #b9d3e3;break-inside:avoid}.sender .date{font-size:9pt;color:#2f5164}.sender .from{text-align:right}.sender .from b{display:block;font-size:12pt;color:#16324a;letter-spacing:.08em}.sender .from span{display:block;font-size:7.5pt;color:#6a8190}.sender img{height:8mm;width:auto;display:block;margin-left:auto;margin-bottom:1.5mm}
.photos{margin-top:2mm}
.dear{padding:4mm 0 1mm}.dear-name{font-size:13pt;color:#16324a;margin-bottom:2mm;letter-spacing:.02em}.dear-name b{font-weight:800;border-bottom:.4mm solid #80cdec;padding-bottom:.4mm}
.glance{display:grid;grid-template-columns:repeat(4,1fr);border:.3mm solid #b9d3e3;border-radius:1.5mm;break-inside:avoid}.glance div{padding:2.6mm 3mm;border-right:.3mm solid #d8eaf4;background:#fbfdff}.glance div:last-child{border-right:0}.glance span{display:block;font-size:7.3pt;color:#6a8190;letter-spacing:.04em}.glance b{display:block;font-size:10.5pt;color:#16324a}
.thanks{margin:2mm 0 4mm;padding:4mm 5mm;background:#f3faff;border-radius:1.5mm;color:#2f5164;font-size:9.3pt;line-height:1.8;text-align:center;break-inside:avoid}
.closing{margin-top:4mm}.closing>section{margin-bottom:4mm}.closing .notices,.closing .sender{break-inside:avoid}
.photos-head{display:flex;align-items:flex-end;justify-content:space-between;gap:4mm;margin-bottom:3mm;padding-bottom:2.5mm;border-bottom:.5mm solid #1f4e8c;break-after:avoid}.photos-head h2{border:0;padding:0;margin:0;font-size:13pt;color:#16324a}.photos-head p{font-size:8pt;color:#6a8190}
.area-photos{margin-bottom:7mm}
.area-head{display:flex;align-items:baseline;gap:2.5mm;padding-bottom:1.6mm;border-bottom:.35mm solid #16324a;break-after:avoid;break-inside:avoid}.area-head .no{font-size:10pt;font-weight:800;color:#8fb3cb;letter-spacing:.04em}.area-head h3{flex:1;font-size:11pt;font-weight:700;color:#16324a}.area-head p{font-size:7.8pt;color:#6a8190;white-space:nowrap}
.area-scope{font-size:7.8pt;color:#567486;margin-top:1.6mm;break-after:avoid}.area-note{font-size:7.6pt;color:#7a8f9c;margin-top:.5mm;break-after:avoid}
.pair{margin-top:4mm;break-inside:avoid}.pair-label{font-size:7.3pt;font-weight:700;color:#386f8a;letter-spacing:.06em;margin-bottom:1.3mm}
.pair-body{display:grid;grid-template-columns:1fr 6mm 1fr;align-items:center}.arrow{text-align:center;color:#9fb6c6;font-size:11pt;margin-top:-5mm}
.group{margin-top:4.5mm}.group-head{font-size:8pt;font-weight:700;color:#16324a;margin-bottom:1.6mm;padding-left:2mm;border-left:.7mm solid #16324a;line-height:1.3;break-after:avoid}.group-head.before{border-left-color:#9fb0bd}.group-head.during{border-left-color:#3c9a6c}.group-head small{font-weight:500;color:#7a8f9c;margin-left:1.8mm}
.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:3.5mm 3mm}
figure.shot{margin:0;border:0;background:none;min-width:0;break-inside:avoid}
.shot .frame{height:64mm;background:#f2f5f8;border:.25mm solid #dde6ee}.shots .shot .frame{height:43mm}
.shot img,.shot .missing-photo{display:block;width:100%;height:100%;object-fit:contain;background:none}
.shot figcaption{display:flex;gap:2mm;align-items:baseline;padding:1.3mm 0 0;border:0;font-size:7.4pt;color:#4b6b7e;line-height:1.45;white-space:normal}
.shot figcaption .tag{flex:none;font-weight:700;font-size:7pt;letter-spacing:.02em;padding:.2mm 1.8mm;border-radius:.6mm}.shot.before .tag{color:#4b6b7e;background:#eef2f5;box-shadow:inset 0 0 0 .2mm #cfd9e1}.shot.after .tag{color:#fff;background:#16324a}.shot.during .tag{color:#2b6e4f;background:#e9f4ee}
.grid-row{display:grid;grid-template-columns:1fr 1fr;gap:0 3mm;margin-top:3mm;break-inside:avoid}.grid-row.single figure{grid-column:1 / span 2;justify-self:center;width:calc(50% - 1.5mm)}
figure{margin:0;border:.25mm solid #dde6ee;background:#fff;min-width:0;break-inside:avoid}
.photo-bar{display:flex;justify-content:space-between;align-items:center;gap:2mm;padding:1.3mm 2.5mm;font-size:7.5pt;background:#f2f5f8;color:#16324a}
figure img,.missing-photo{display:block;width:100%;height:58mm;object-fit:contain;background:#f2f5f8}.missing-photo{display:grid;place-items:center;color:#8b95a1;font-size:8pt}
figcaption{padding:1.5mm 2.5mm;color:#49697d;font-size:7.3pt;line-height:1.45;white-space:pre-wrap}figcaption b{font-weight:600}figcaption span{color:#5d7b8d}`;
}
function createOwnerReportHtml(report, options = {}) {
  // 공용부 청소는 '공용부 활동 결과보고서' 양식으로 따로 만든다. 그 모듈이 이 파일의 글꼴·로고를
  // 쓰므로 여기서는 호출할 때 불러온다(맨 위에서 서로 require 하면 한쪽이 빈 모듈을 받는다).
  if (report.kind === "common") return require("./work-report-common-pdf").createCommonActivityReportHtml(report, options);
  const company = options.company && typeof options.company === "object" ? options.company : {};
  const images = options.images && typeof options.images === "object" ? options.images : {};
  // 현장노트는 고른 구역을 사진이 없어도 표에 남긴다(includeEmptyAreas).
  const items = report.items.filter(item => options.includeEmptyAreas || item.status !== "recorded" || count(item) || item.note);
  const photoItems = items.filter(count);
  const date = report.workDate || "날짜 미기재";
  const kind = Core.kindLabel(report.kind);
  // 고객 단위 보고서(건물 미연결)는 buildingName 에 CRM 고객 이름이 들어 있다.
  // 실명·내부 별명이 건물주용 문서의 제목·현장 칸에 나가지 않게, 연결된 건물이
  // 있을 때만 건물명을 쓰고 아니면 현장 주소를 쓴다.
  const site = (report.buildingId && report.buildingName) || report.siteAddress || "";
  const building = site || "현장";
  // 수신인은 실명이 아니라 "(주소) 건물주" 로 쓴다. CRM 이름·별명은 내부용이다.
  // '귀하' 하나로 높인다 — "건물주님 귀하" 는 높임이 겹친다.
  const recipient = CustomerCore.reportOwnerName({ address: report.siteAddress });
  const sender = company.businessName || "브링케어";
  const documentNo = Core.documentNo(report);
  const totals = Object.fromEntries(Object.keys(PHASES).map(phase => [phase, items.reduce((n, item) => n + item[phase].length, 0)]));
  // 값이 있는 칸만 싣는다. 빈칸이 남으면 받는 쪽은 안 적은 것인지 없는 것인지 모른다.
  const facts = [
    // 작업일·작업 종류는 위 '한눈에 보기' 에 이미 있다. 같은 값을 두 번 싣지 않는다.
    ["현장", site !== report.siteAddress ? site : ""], ["현장 주소", report.siteAddress],
    ["작업 구분", options.omitUnspecifiedCategory ? "" : Core.categoryLabel(report.category) + (report.category === "etc" && report.categoryEtc ? ` · ${report.categoryEtc}` : "")],
    ["작업 범위", report.area], ["담당자", report.workerName],
  ].filter(([, value]) => value);
  const stats = [["작업 구역", `${items.length}곳`], ...Object.entries(PHASES).filter(([phase]) => phase !== "during" || totals.during).map(([phase, label]) => [label, `${totals[phase]}장`])];
  const glance = [["작업일", date], ["작업 종류", kind], ["작업 구역", `${items.length}곳`], ["사진 기록", `${totals.before + totals.during + totals.after}장`]];
  const senderLine = [sender, company.representative ? `대표 ${company.representative}` : "", company.registrationNumber ? `사업자등록번호 ${company.registrationNumber}` : ""].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><title>작업 결과 보고서</title><style>
${ownerReportStyles(`작업 결과보고서 · ${documentNo}`)}
</style></head><body><main>
<section class="overview">
<header class="doc-head">${LOGO ? `<img class="brand-logo" src="${LOGO}" alt="BRING CARE">` : '<span class="brand-text">BRING CARE</span>'}<div class="doc-title"><h1>작업 결과보고서</h1><p>WORK COMPLETION REPORT</p></div></header>
<table class="letter"><tbody>
<tr><th>문서번호</th><td>${escape(documentNo)}</td></tr>
<tr><th>수신(건물주)</th><td>${escape(recipient)} 귀하</td></tr>
<tr><th>발신</th><td>${escape(senderLine)}</td></tr>
<tr><th>제목</th><td>${site ? `${escape(site)} ` : ""}${escape(kind)} 작업 결과 보고 (작업일 ${escape(date)})</td></tr>
</tbody></table>
<section class="dear"><p class="dear-name"><b>${escape(recipient)}</b> 귀하</p><p class="greeting">항상 브링케어를 믿고 소중한 건물을 맡겨 주시는 ${escape(recipient)}님께 진심으로 감사드립니다.\n${escape(date)} 귀 건물의 ${escape(kind)} 작업을 아래와 같이 정성껏 수행하였기에 그 결과를 삼가 보고드립니다.</p></section>
<div class="glance">${glance.map(([label, value]) => `<div><span>${label}</span><b>${escape(value)}</b></div>`).join("")}</div>
<section class="monthly-summary"><h2>이번 작업 요약</h2><p class="greeting">${escape(report.summary || "구역별 현장 기록을 정리했습니다. 등록된 작업 내용과 사진은 아래에서 확인하실 수 있습니다.")}</p></section>
<section><h2>작업 정보</h2><table class="facts"><tbody>${facts.map(([label, value]) => `<tr><th>${label}</th><td>${escape(value)}</td></tr>`).join("")}</tbody></table></section>
<section><h2>사진 기록 요약</h2><div class="stats">${stats.map(([label, value]) => `<div class="stat"><span>${label}</span><b>${value}</b></div>`).join("")}</div></section>
<section><h2>구역별 작업 기록</h2>${items.length ? `<table class="areas"><thead><tr><th>No.</th><th>작업 구역</th><th>수행 내용</th><th>현장 사진</th></tr></thead><tbody>${items.map((item, i) => `<tr><td>${i + 1}</td><td>${escape(item.label)}</td><td>${escape(options.includeEmptyAreas && item.status === "recorded" && !count(item) && !item.note ? "보고서 포함 사진 없음" : recordText(item))}</td><td>${escape(photoCounts(item))}</td></tr>`).join("")}</tbody></table>` : '<p class="greeting">등록된 작업 기록이 없습니다.</p>'}</section>
</section>
${photoItems.length ? `<section class="photos">
<div class="photos-head"><h2>구역별 작업 전·후 사진</h2><p>${escape(building)} · 작업일 ${escape(date)}</p></div>
${photoItems.map((item, i) => areaPhotos(item, i + 1, images)).join("")}
</section>` : ""}
<section class="closing">
<section class="follow"><h2>추가 안내</h2><p>${escape(report.followUp || "등록된 후속 조치 사항은 없습니다. 궁금하신 점이나 추가로 살펴볼 부분은 브링케어로 말씀해 주세요.")}</p></section>
<section class="notices">${Core.NOTICES.map(line => `<p>· ${escape(line)}</p>`).join("")}</section>
<p class="thanks">앞으로도 ${escape(building)}을(를) 내 건물처럼 세심하게 살피겠습니다. 궁금하신 점은 언제든 브링케어로 말씀해 주십시오. 감사합니다.</p>
<section class="sender"><p class="date">${escape(date)}</p><div class="from">${LOGO ? `<img src="${LOGO}" alt="">` : ""}<b>${escape(sender)} 드림</b><span>문서번호 ${escape(documentNo)} · 작성 업체 ${escape(sender)}</span></div></section>
</section>
</main></body></html>`;
}

module.exports = { createOwnerReportHtml, photoPages, areaPhotos, ownerReportStyles, ownerFontFace, ownerLogo: () => LOGO, FONT_STACK, SAFE_IMAGE, escape };
