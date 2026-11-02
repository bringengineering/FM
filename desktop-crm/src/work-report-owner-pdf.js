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

function figure(item, photo, phase, number, images) {
  const source = images[photo.id];
  // Accept only embedded raster images. No remote URLs, SVG or file paths.
  const safe = typeof source === "string" && SAFE_IMAGE.test(source);
  const tag = number ? `${PHASES[phase]} ${number}` : PHASES[phase];
  return `<figure class="${phase}"><div class="photo-bar"><b>${tag}</b><span>${PHASE_EN[phase]}</span></div>${safe ? `<img src="${escape(source)}" alt="${escape(`${item.label} · ${tag}`)}">` : '<div class="missing-photo">사진 없음</div>'}<figcaption><b>${escape(item.label)} · ${tag}</b>${photo.caption ? `<span>${escape(photo.caption)}</span>` : ""}</figcaption></figure>`;
}

// 한 구역의 사진. 전·후는 같은 번호끼리 좌우로 짝지어 비교하게 하고,
// 짝이 없는 사진과 작업 중 사진은 그 아래에 단계 표시를 붙여 이어 싣는다.
// 구역마다 새 쪽을 강제하지 않는다 — 사진 두 장에 한 쪽을 쓰면 빈 종이가 된다.
// 한 구역의 사진. 작업 전·후 장수가 같으면 같은 번호끼리 나란히 짝짓는다
// (초안이 같은 장소로 묶인 짝을 앞에, 나머지를 촬영 시각 순으로 세워 둔다).
// 장수가 다르면 순서만으로는 같은 장소를 보장할 수 없으므로 억지로 짝짓지 않고
// 작업 전·작업 후를 따로 모아 싣는다. 다른 장소가 나란히 붙는 것보다 낫다.
// 구역마다 새 쪽을 강제하지 않는다 — 사진 두 장에 한 쪽을 쓰면 빈 종이가 된다.
function photoGrid(item, entries, images) {
  const grid = [];
  for (let i = 0; i < entries.length; i += 2) {
    grid.push(`<div class="grid-row${i + 1 === entries.length ? " single" : ""}">${entries.slice(i, i + 2).map(entry => figure(item, entry.photo, entry.phase, entry.n, images)).join("")}</div>`);
  }
  return grid.join("");
}
function areaPhotos(item, index, images) {
  const paired = item.before.length > 0 && item.before.length === item.after.length;
  const rows = paired ? item.before.map((photo, i) => `<div class="pair-row"><span class="pair-no">${i + 1}</span>${figure(item, photo, "before", i + 1, images)}${figure(item, item.after[i], "after", i + 1, images)}</div>`) : [];
  const numbered = phase => item[phase].map((photo, i) => ({ photo, phase, n: i + 1 }));
  const notes = [];
  if (!item.before.length && item.after.length) notes.push("이 구역은 작업 후 사진으로 기록했습니다.");
  else if (item.before.length && !item.after.length) notes.push("이 구역은 작업 전 사진으로 기록했습니다.");
  else if (!paired && item.before.length) notes.push(`작업 전 ${item.before.length}장과 작업 후 ${item.after.length}장은 같은 장소끼리 짝이 맞지 않아 단계별로 나누어 실었습니다.`);
  const section = (phase, label) => item[phase].length ? `<div class="phase-head ${phase}"><span>${label}</span><small>${item[phase].length}장</small></div>${photoGrid(item, numbered(phase), images)}` : "";
  return `<section class="area-photos">
    <div class="area-head"><h3><span>${index}</span>${escape(item.label)}</h3><p>${escape(photoCounts(item, true))}</p></div>
    ${item.detail ? `<p class="area-scope">수행 범위 · ${escape(item.detail)}</p>` : ""}
    ${notes.map(line => `<p class="area-note">${escape(line)}</p>`).join("")}
    ${paired ? `<div class="pair-head"><span class="before">작업 전 BEFORE</span><span class="after">작업 후 AFTER</span></div>${rows.join("")}` : `${section("before", "작업 전 BEFORE")}${section("after", "작업 후 AFTER")}`}
    ${section("during", "작업 중 DURING")}
  </section>`;
}

function createOwnerReportHtml(report, options = {}) {
  const company = options.company && typeof options.company === "object" ? options.company : {};
  const images = options.images && typeof options.images === "object" ? options.images : {};
  const items = report.items.filter(item => item.status !== "recorded" || count(item) || item.note);
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
    ["작업 구분", Core.categoryLabel(report.category) + (report.category === "etc" && report.categoryEtc ? ` · ${report.categoryEtc}` : "")],
    ["작업 범위", report.area], ["담당자", report.workerName],
  ].filter(([, value]) => value);
  const stats = [["작업 구역", `${items.length}곳`], ...Object.entries(PHASES).filter(([phase]) => phase !== "during" || totals.during).map(([phase, label]) => [label, `${totals[phase]}장`])];
  const glance = [["작업일", date], ["작업 종류", kind], ["작업 구역", `${items.length}곳`], ["사진 기록", `${totals.before + totals.during + totals.after}장`]];
  const senderLine = [sender, company.representative ? `대표 ${company.representative}` : "", company.registrationNumber ? `사업자등록번호 ${company.registrationNumber}` : ""].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><title>작업 결과 보고서</title><style>
${PRETENDARD ? `@font-face{font-family:"Pretendard";src:url(${PRETENDARD}) format("woff2-variations"),url(${PRETENDARD}) format("woff2");font-weight:45 920;font-style:normal;font-display:block}` : ""}
@page{size:A4 portrait;margin:14mm 12mm 14mm;@top-right{content:"작업 결과보고서 · ${escape(documentNo)}";font-family:${FONT_STACK};font-size:7pt;color:#7a8f9c;vertical-align:bottom}@bottom-left{content:"BRING CARE · 건물주 제출용";font-family:${FONT_STACK};font-size:7pt;color:#6a8190;vertical-align:middle}@bottom-right{content:counter(page) " / " counter(pages);font-family:${FONT_STACK};font-size:7pt;color:#6a8190;vertical-align:middle}}
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
.legend{display:flex;gap:2mm;margin-bottom:4mm}.legend span{padding:.8mm 2.5mm;border-radius:1mm;font-size:7.5pt;font-weight:700}
.area-photos{margin-bottom:6mm}
.area-head{display:flex;justify-content:space-between;align-items:center;gap:3mm;padding:2mm 3mm;background:#eaf6fd;border-top:.6mm solid #80cdec;break-after:avoid;break-inside:avoid}.area-head h3{font-size:10.5pt;color:#16324a}.area-head h3 span{display:inline-block;min-width:6mm;margin-right:2mm;color:#1f4e8c}.area-head p{font-size:7.8pt;color:#4b6b7e;white-space:nowrap}
.area-scope,.area-note{font-size:7.8pt;color:#567486;padding:1.2mm 3mm 0;break-after:avoid}.area-note{color:#8a5a12}
.pair-head{display:grid;grid-template-columns:7mm 1fr 1fr;gap:0 3mm;margin-top:2mm;break-after:avoid}.pair-head span{text-align:center;font-size:8pt;font-weight:800;letter-spacing:.06em;padding:1.2mm 0;border-radius:1mm}.pair-head span:first-child{grid-column:2}
.pair-head .before,.legend .before{background:#fff1dc;color:#8a5a12}.pair-head .after,.legend .after{background:#e3effb;color:#1f5aa6}.legend .during{background:#e3f4ec;color:#2b6e4f}
.pair-row{display:grid;grid-template-columns:7mm 1fr 1fr;gap:0 3mm;margin-top:2mm;break-inside:avoid;align-items:start}
.pair-no{align-self:center;text-align:center;font-weight:800;color:#1f4e8c;font-size:10pt}
.phase-head{display:flex;justify-content:space-between;align-items:center;margin:3mm 0 0 10mm;padding:1.2mm 3mm;border-radius:1mm;font-size:8pt;font-weight:800;letter-spacing:.06em;break-after:avoid}.phase-head small{font-size:7.5pt;font-weight:600;letter-spacing:0}.phase-head.before{background:#fff1dc;color:#8a5a12}.phase-head.after{background:#e3effb;color:#1f5aa6}.phase-head.during{background:#e3f4ec;color:#2b6e4f}
.grid-row{display:grid;grid-template-columns:7mm 1fr 1fr;gap:0 3mm;margin-top:2mm;break-inside:avoid}.grid-row figure:first-child{grid-column:2}.grid-row.single figure{grid-column:2 / span 2;justify-self:center;width:calc(50% - 1.5mm)}
figure{margin:0;border:.3mm solid #d8eaf4;background:#fff;min-width:0;break-inside:avoid}
figure.before{border-top:1mm solid #e3a33b}figure.after{border-top:1mm solid #2f7fd0}figure.during{border-top:1mm solid #3c9a6c}
.photo-bar{display:flex;justify-content:space-between;align-items:center;padding:1.3mm 2.5mm;font-size:7.5pt}.photo-bar span{letter-spacing:.12em;font-size:6.5pt;font-weight:700}
figure.before .photo-bar{background:#fff1dc;color:#8a5a12}figure.after .photo-bar{background:#e3effb;color:#1f5aa6}figure.during .photo-bar{background:#e3f4ec;color:#2b6e4f}
figure img,.missing-photo{display:block;width:100%;height:58mm;object-fit:contain;background:#fff}.missing-photo{display:grid;place-items:center;color:#8b95a1;font-size:8pt;background:#f4f9fc}
figcaption{padding:1.5mm 2.5mm;color:#49697d;font-size:7.3pt;line-height:1.45;white-space:pre-wrap;border-top:.2mm solid #eef4f8}figcaption b{font-weight:600;display:block}figcaption span{display:block;color:#5d7b8d}
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
<section><h2>구역별 작업 기록</h2>${items.length ? `<table class="areas"><thead><tr><th>No.</th><th>작업 구역</th><th>수행 내용</th><th>현장 사진</th></tr></thead><tbody>${items.map((item, i) => `<tr><td>${i + 1}</td><td>${escape(item.label)}</td><td>${escape(recordText(item))}</td><td>${escape(photoCounts(item))}</td></tr>`).join("")}</tbody></table>` : '<p class="greeting">등록된 작업 기록이 없습니다.</p>'}</section>
</section>
${photoItems.length ? `<section class="photos">
<div class="photos-head"><h2>구역별 작업 전·후 사진</h2><p>${escape(building)} · 작업일 ${escape(date)}</p></div>
<div class="legend"><span class="before">작업 전 BEFORE</span><span class="after">작업 후 AFTER</span>${totals.during ? '<span class="during">작업 중 DURING</span>' : ""}</div>
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

module.exports = { createOwnerReportHtml, photoPages };
