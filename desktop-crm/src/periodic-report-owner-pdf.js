"use strict";
// 정기 관리보고서(격주) 건물주 제출용. 작업 결과보고서와 같은 얼굴을 하도록 글꼴·색·
// 사진 카드는 work-report-owner-pdf 의 것을 그대로 쓴다. 이 파일은 순서만 정한다:
// (건물 사진이 있으면) 표지 → 요약 → 공용부 청소 내역 → 정기점검 결과 → 조치 사항 진행 →
// 법정점검 현황 → 점검 사진 → 청소 사진 → 맺음. 쪽을 억지로 넘기지 않아 중간에 빈 쪽이 생기지 않는다.
const CustomerCore = require("./core");
const WorkReport = require("./work-report-core");
const Periodic = require("./periodic-report-core");
const Owner = require("./work-report-owner-pdf");

const { escape, SAFE_IMAGE } = Owner;
const BADGE_CLASS = { good: "good", watch: "watch", fix: "fix", done: "done" };
const badge = status => `<span class="badge ${BADGE_CLASS[status] || "good"}">${escape(Periodic.statusLabel(status))}</span>`;
const ORDER = { fix: 0, watch: 1, done: 2, good: 3 };

const EXTRA_CSS = `
.badge{display:inline-block;padding:.5mm 2.2mm;border-radius:1mm;font-size:7.3pt;font-weight:800;letter-spacing:.02em;white-space:nowrap}
.badge.good{background:#e3f4ec;color:#2b6e4f}.badge.watch{background:#fff1dc;color:#8a5a12}.badge.fix{background:#fde4e1;color:#b03a2e}.badge.done{background:#e3effb;color:#1f5aa6}
table.clean th:nth-child(1){width:18mm;text-align:center}table.clean td:first-child{text-align:center;font-weight:700;color:#1f4e8c}table.clean th:nth-child(2){width:25mm}table.clean th:nth-child(3){width:46mm}table.clean th:nth-child(4){width:auto}table.clean th:nth-child(5){width:14mm}table.clean td:nth-child(5){text-align:center}
table.check th:nth-child(2){width:16mm}table.check th:nth-child(3){width:38mm}table.check th:nth-child(4){width:21mm}table.check th:nth-child(5){width:auto}table.check th:nth-child(6){width:36mm}.thumb-cell{vertical-align:middle!important}.thumbs{display:flex;gap:1mm;align-items:center}.compare{margin-bottom:6mm;break-inside:avoid}.compare .grid-row{grid-template-columns:1fr 1fr}.compare .grid-row figure:first-child{grid-column:auto}.compare-note{font-size:7.8pt;color:#4b6b7e;padding:1.5mm 1mm 0}
.thumbs img{width:14mm;height:11mm;object-fit:cover;border-radius:.8mm;border:.2mm solid #d8eaf4}.thumbs small{font-size:7pt;color:#6a8190;white-space:nowrap}.no-thumb{font-size:7.3pt;color:#8b9aa5}
table.check td:nth-child(2){color:#386f8a;font-weight:600}table.check tr.cat-start td{border-top:.35mm solid #b9d3e3}
table.act th:nth-child(1){width:38mm;text-align:left}table.act td:first-child{text-align:left;color:#1d3b4f;font-weight:600}table.act th:nth-child(2){width:auto}table.act th:nth-child(4){width:21mm}
.wk{display:block;white-space:nowrap;font-size:7.3pt;color:#6a8190;font-weight:500;margin-top:.5mm}.cdate{color:#16324a}
.tally{display:flex;gap:2mm;margin:-.5mm 0 2.5mm;font-size:7.8pt;color:#567486;align-items:center}
.next{width:100%;border-collapse:collapse}.next td{padding:2mm 3mm;border-bottom:.2mm solid #d8eaf4;font-size:8.7pt}.next td:first-child{width:45mm;color:#386f8a;font-weight:700}
.closing>section:first-child,.next{break-inside:avoid}
.round{margin-bottom:5mm}.round-head{display:flex;gap:3mm;align-items:baseline;padding:2.2mm 3mm;background:#16324a;color:#fff;break-after:avoid;margin-bottom:2mm}.round-head b{font-size:11pt}.round-head span{font-size:8.3pt;color:#cfe6f3}
.insp-grid .grid-row{grid-template-columns:1fr 1fr}.insp-grid .grid-row figure:first-child{grid-column:auto}.insp-grid .grid-row.single figure{grid-column:1 / span 2}
figure.insp{border-top:1mm solid #3c9a6c}figure.insp .photo-bar{background:#eaf6fd;color:#16324a}figure.insp.fix{border-top-color:#d0594a}figure.insp.watch{border-top-color:#e3a33b}figure.insp.done{border-top-color:#2f7fd0}
/* ---- 표지 (건물 사진이 있을 때 한 쪽) ---- */
.cover{height:269mm;display:flex;flex-direction:column;break-after:page}
.cover::before{content:"";display:block;height:2.4mm;border-top:.8mm solid #16324a;border-bottom:.25mm solid #16324a;margin-bottom:4mm}
.cover-top{display:flex;justify-content:space-between;align-items:center;padding-bottom:3mm}.cover-top img{height:10mm}.cover-top span{font-size:7.5pt;letter-spacing:.3em;color:#6a8190}
.cover-title{text-align:center;margin:16mm 0 9mm}.cover-title .eyebrow{font-size:8pt;letter-spacing:.42em;color:#6a8190;margin-bottom:3mm}
.cover-title h1{font-size:26pt;letter-spacing:.16em;color:#16324a;line-height:1.25}.cover-title .bar{width:18mm;height:.5mm;background:#16324a;margin:5mm auto}
.cover-title .site{font-size:13pt;font-weight:700;color:#16324a}.cover-title .period{font-size:10pt;color:#386f8a;margin-top:1.5mm}
.cover-photo{height:104mm;border:.25mm solid #c9d3dc;padding:1.5mm;background:#fff}.cover-photo img{width:100%;height:100%;object-fit:cover;display:block}
.cover-facts{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:6mm;border-top:.7mm solid #16324a;border-bottom:.3mm solid #16324a}
.cover-facts th,.cover-facts td{padding:2.2mm 3mm;font-size:9pt;text-align:left;border-bottom:.2mm solid #d5dde4}.cover-facts th{width:28mm;background:#f1f4f7;color:#16324a}
.cover-foot{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;padding-top:4mm;border-top:.8mm solid #16324a;box-shadow:0 -1.4mm 0 -1.15mm #16324a}
.cover-foot b{font-size:12pt;color:#16324a}.cover-foot span{font-size:7.5pt;color:#6a8190;line-height:1.6}
/* ---- 조치 진행 표 · 법정점검 표 ---- */
.lead{font-size:7.8pt;color:#5b6f7d;margin:-.5mm 0 2.5mm}
table.track th:nth-child(1){width:34mm}table.track th:nth-child(2){width:26mm}table.track th:nth-child(4){width:21mm}
table.track td:first-child,table.legal td:first-child,table.track th:first-child,table.legal th:first-child{text-align:left}
table.track td:first-child{font-weight:600;color:#1d3b4f}table.track td:first-child small{display:block;font-weight:400;color:#5b6f7d;font-size:7.3pt;margin-top:.5mm;white-space:normal}
.steps{display:flex;flex-wrap:wrap;gap:.8mm 0;align-items:center;font-size:8pt;color:#34586e;white-space:normal}.steps i{font-style:normal;color:#9fb6c6;margin:0 1.4mm}.steps b{font-weight:600;color:#16324a}
table.legal th:nth-child(1){width:46mm}table.legal th:nth-child(2){width:20mm}table.legal th:nth-child(3){width:26mm}table.legal th:nth-child(4){width:34mm}table.legal th:nth-child(5){width:auto}table.legal td:first-child{font-weight:600;color:#1d3b4f}
table.legal tr.soon td{background:#fbf7ee}table.legal tr.late td{background:#fdf3f1}
.due{display:block;font-size:7.3pt;color:#8a5a12;font-weight:700;margin-top:.4mm}.due.calm{color:#6a8190;font-weight:500}.due.late{color:#b03a2e}
.foot-note{font-size:7.4pt;color:#7a8f9c;margin-top:1.8mm}
/* ---- 격식: 남색·회색, 굵은 위 선 + 가는 아래 선 ---- */
tr{break-inside:avoid}thead{display:table-header-group}
h2{border-left:0;padding:0 0 1.4mm;margin:0 0 2.6mm;border-bottom:.3mm solid #16324a;font-size:11.5pt;letter-spacing:.04em;color:#16324a}
.monthly-summary{background:#fff;border:.25mm solid #c9d3dc;border-top:.7mm solid #16324a}.monthly-summary h2{border:0;padding:0;margin-bottom:1.5mm}
.glance{border:0;border-top:.7mm solid #16324a;border-bottom:.3mm solid #16324a;border-radius:0}.glance div{background:#fff;border-right:.2mm solid #c9d3dc}
.letter{border-top:.7mm solid #16324a;border-bottom:.3mm solid #16324a}.letter th{background:#f1f4f7;color:#16324a}.letter th,.letter td{border-bottom:.2mm solid #d5dde4}
.areas{border-top:.7mm solid #16324a;border-bottom:.3mm solid #16324a}.areas th{background:#f1f4f7;color:#16324a;font-weight:700;border-bottom:.3mm solid #16324a}.areas td{border-bottom:.2mm solid #d5dde4}
.badge{background:#fff!important;border:.25mm solid currentColor;border-radius:.6mm;padding:.3mm 2mm;font-weight:700}
.next{border-top:.7mm solid #16324a;border-bottom:.3mm solid #16324a}.next td:first-child{color:#16324a}
.follow{background:#fff;border:.25mm solid #c9d3dc;border-top:.7mm solid #16324a}
.thanks{background:#fff;border-top:.2mm solid #c9d3dc;border-bottom:.2mm solid #c9d3dc;border-radius:0}
.photos{margin-top:5mm}.photos-head{border-bottom:.7mm solid #16324a}.photos-head h2{border:0;margin:0;padding:0}
.round-head{background:#16324a}figure.insp .photo-bar{background:#f1f4f7}
/* 구역 안의 단계 묶음은 장수만큼 폭을 나눠 한 줄을 채운다(1+1 → 반반, 1+2 → 1/3·2/3). */
.area-photos{display:flex;flex-wrap:wrap;column-gap:3mm;margin-bottom:5mm}.area-photos>*{flex:0 0 100%;min-width:0}
.area-photos>.group:has(.shots>figure:only-child){flex:1 1 0}.area-photos>.group:has(.shots>figure:nth-child(2):last-child){flex:2 1 0}
.area-photos>.group:has(.shots>figure:only-child) .shots{grid-template-columns:1fr}.area-photos>.group:has(.shots>figure:nth-child(2):last-child) .shots{grid-template-columns:1fr 1fr}
.area-photos>.group .shot .frame{height:44mm;background:#f7f9fb}
/* 사진 한 장뿐인 구역은 한 줄을 다 쓰지 않는다(양옆이 빈 회색 칸이 된다). */
.area-photos:not(:has(.group ~ .group))>.group:has(.shots>figure:only-child){flex:0 0 calc(50% - 1.5mm)}.pair .shot .frame{height:46mm}.pair{margin-top:2.5mm}.group{margin-top:3mm}
/* 정기점검 사진은 3열 */
.insp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm;margin-top:3mm}.insp-grid .grid-row{display:contents}
.insp-grid .grid-row.single figure{grid-column:auto;width:auto;justify-self:stretch}.insp-grid figure img,.insp-grid .missing-photo{height:38mm}
`;

function inspectionFigure(item, photo, images) {
  const source = images[photo.id];
  const safe = typeof source === "string" && SAFE_IMAGE.test(source);
  return `<figure class="insp ${BADGE_CLASS[item.status] || "good"}"><div class="photo-bar"><b>${escape(item.category)} · ${escape(item.label)}</b>${badge(item.status)}</div>${safe ? `<img src="${escape(source)}" alt="${escape(item.label)}">` : '<div class="missing-photo">사진 없음</div>'}<figcaption>${item.note ? `<span>${escape(item.note)}</span>` : ""}${photo.caption ? `<span>${escape(photo.caption)}</span>` : ""}</figcaption></figure>`;
}

// 지난 점검과 이번 점검을 나란히. 같은 항목·같은 위치를 비교하는 자리다.
function compareRow(item, images) {
  const pic = (photo, cls, tag, sub) => {
    const source = images[photo.id];
    const safe = typeof source === "string" && SAFE_IMAGE.test(source);
    return `<figure class="insp ${cls}"><div class="photo-bar"><b>${escape(tag)}</b>${sub}</div>${safe ? `<img src="${escape(source)}" alt="${escape(item.label)} ${escape(tag)}">` : '<div class="missing-photo">사진 없음</div>'}</figure>`;
  };
  const prev = item.previous;
  return `<section class="compare"><div class="area-head"><h3>${escape(item.category)} · ${escape(item.label)}</h3><p>지난 점검 ${escape(prev.dateLabel)} → 이번 점검</p></div>
    <div class="grid-row">${pic(prev.photos[0], BADGE_CLASS[prev.status] || "good", `지난 점검 · ${prev.dateLabel}`, badge(prev.status))}${pic(item.photos[0], BADGE_CLASS[item.status] || "good", "이번 점검", badge(item.status))}</div>
    <p class="compare-note">${prev.note ? `지난번: ${escape(prev.note)} · ` : ""}이번: ${escape(item.note || Periodic.statusLabel(item.status))}</p></section>`;
}

function grid(figures) {
  const out = [];
  for (let i = 0; i < figures.length; i += 2) out.push(`<div class="grid-row${i + 1 === figures.length ? " single" : ""}">${figures.slice(i, i + 2).join("")}</div>`);
  return out.join("");
}

function createPeriodicReportHtml(view, options = {}) {
  const company = options.company && typeof options.company === "object" ? options.company : {};
  const images = options.images && typeof options.images === "object" ? options.images : {};
  const logo = Owner.ownerLogo();
  const sender = company.businessName || "브링케어";
  const recipient = CustomerCore.reportOwnerName({ address: view.siteAddress });
  const period = view.period || { label: "", range: "" };
  const counts = view.counts || {};
  const cleanings = view.cleanings || [];
  const items = (view.inspection && view.inspection.items) || [];
  const cleaningDates = cleanings.map(row => row.shortDate.replace(/\(.\)$/u, "")).join(" · ") || "기록 없음";
  const glance = [["보고 기간", period.range], ["공용부 청소 (주 1회)", cleaningDates], ["정기점검", `${items.length}개 항목`], ["조치 필요", `${counts.fix || 0}건`]];
  const senderLine = [sender, company.representative ? `대표 ${company.representative}` : "", company.registrationNumber ? `사업자등록번호 ${company.registrationNumber}` : ""].filter(Boolean).join(" · ");
  const today = Periodic.dateLabel(options.issuedAt || new Date().toISOString().slice(0, 10)).replace(/\(.\)$/u, "");

  // 점검 결과 표에서 바로 볼 수 있게, 사진이 있는 항목은 표 안에 작은 사진을 싣는다.
  // 큰 사진은 바로 뒤 '정기점검 사진' 에 있다. 사진이 없는 항목은 육안 확인으로 적는다.
  const withPhotos = items.some(item => item.photos.length);
  const thumb = item => {
    const safe = item.photos.map(photo => images[photo.id]).filter(source => typeof source === "string" && SAFE_IMAGE.test(source));
    if (!safe.length) return '<span class="no-thumb">육안 확인</span>';
    return `<div class="thumbs">${safe.slice(0, 2).map(source => `<img src="${escape(source)}" alt="${escape(item.label)}">`).join("")}${safe.length > 2 ? `<small>+${safe.length - 2}</small>` : ""}</div>`;
  };
  let lastCategory = "";
  const checkRows = items.map((item, i) => {
    const first = item.category !== lastCategory;
    const row = `<tr${first && i ? ' class="cat-start"' : ""}><td>${i + 1}</td><td>${first ? escape(item.category) : ""}</td><td>${escape(item.label)}</td><td>${badge(item.status)}</td><td>${escape(item.note || (item.status === "good" ? "이상 없음" : ""))}</td>${withPhotos ? `<td class="thumb-cell">${thumb(item)}</td>` : ""}</tr>`;
    lastCategory = item.category;
    return row;
  }).join("");

  const actions = (view.actions || []).slice().sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const legal = view.legal || [];
  // 표지는 건물 사진이 있을 때만 따로 한 쪽을 쓴다. 사진 없이 빈 액자를 두지 않는다.
  const cover = view.cover || {};
  const coverSource = cover.photo ? images[cover.photo.id] : "";
  const hasCover = typeof coverSource === "string" && SAFE_IMAGE.test(coverSource);
  const site = view.siteAddress || view.buildingName || "";
  const coverFacts = [["건물", site], ["규모", cover.scale], ["관리 범위", cover.scope], ["관리 시작", cover.since]].filter(([, value]) => value);
  const coverHtml = hasCover ? `<section class="cover">
<div class="cover-top">${logo ? `<img src="${logo}" alt="BRING CARE">` : '<b class="brand-text">BRING CARE</b>'}<span>BUILDING CARE REPORT</span></div>
<div class="cover-title"><p class="eyebrow">REGULAR CARE REPORT</p><h1>정기 관리보고서</h1><div class="bar"></div><p class="site">${escape(site)}</p><p class="period">${escape(period.label)} · ${escape(period.range)}</p></div>
<div class="cover-photo"><img src="${escape(coverSource)}" alt="건물 전경"></div>
<table class="cover-facts"><tbody>${coverFacts.map(([label, value]) => `<tr><th>${label}</th><td>${escape(value)}</td></tr>`).join("")}</tbody></table>
<div class="cover-foot"><span>문서번호 ${escape(view.documentNo)}<br>제출일 ${escape(today)}</span><b>${escape(sender)} 드림</b></div>
</section>` : "";
  // 3·4장은 있을 때만 싣고, 번호는 실린 순서대로 붙인다.
  let sectionNo = 2;
  const doneCount = actions.filter(item => item.status === "done").length;
  const trackHtml = actions.length ? `<section><h2>${++sectionNo}. 조치 사항 진행</h2><p class="lead">점검에서 확인한 사항은 끝날 때까지 매 보고서에 이어서 적습니다.${doneCount ? ` 이번 보고서에서 완료된 ${doneCount}건은 다음 보고서부터 빠집니다.` : ""}</p>
<table class="areas track"><thead><tr><th>항목</th><th>처음 확인</th><th>진행 경과</th><th>현재</th></tr></thead><tbody>${actions.map(item => `<tr><td>${escape(item.label)}${item.finding ? `<small>${escape(item.finding)}</small>` : ""}</td><td>${escape(item.sinceLabel || "")}</td><td><div class="steps">${(item.steps || []).map(step => `<span>${step.date ? `<b>${escape(step.date)}</b> ` : ""}${escape(step.text)}</span>`).join("<i>→</i>")}</div></td><td>${`<span class="badge ${BADGE_CLASS[item.status] || "fix"}">${escape(item.stateLabel || Periodic.statusLabel(item.status))}</span>`}</td></tr>`).join("")}</tbody></table></section>` : "";
  const legalHtml = legal.length ? `<section><h2>${++sectionNo}. 법정점검 현황</h2><p class="lead">법정점검은 전문 업체가 수행하고, 브링케어는 일정 관리·업체 예약·결과 보관·후속 조치를 챙깁니다. 다음 점검이 가까운 순서입니다.</p>
<table class="areas legal"><thead><tr><th>점검</th><th>주기</th><th>최근 점검</th><th>결과</th><th>다음 예정</th></tr></thead><tbody>${legal.map(item => `<tr${item.tone === "soon" || item.tone === "late" ? ` class="${item.tone}"` : ""}><td>${escape(item.name)}</td><td>${escape(item.cycleLabel)}</td><td>${escape(item.lastLabel)}</td><td><span class="badge ${BADGE_CLASS[item.result] || "watch"}">${escape(item.resultLabel)}</span></td><td>${escape(item.nextLabel)}${item.due ? `<span class="due${item.tone === "soon" ? "" : ` ${item.tone}`}">${escape(item.due)}</span>` : ""}</td></tr>`).join("")}</tbody></table><p class="foot-note">· 업체 점검 보고서 원본은 브링케어가 보관하며, 요청하시면 바로 보내 드립니다.</p></section>` : "";
  const cleaningPhotos = cleanings.map(row => {
    const areas = row.items.filter(item => item.before.length + item.during.length + item.after.length);
    if (!areas.length) return "";
    return `<section class="round"><div class="round-head"><b>${row.no}회차 · ${escape(row.dateLabel)}</b><span>${escape(row.week)}${row.areas ? ` · ${escape(row.areas)}` : ""}</span></div>${areas.map((item, i) => Owner.areaPhotos(item, `${row.no}-${i + 1}`, images)).join("")}</section>`;
  }).join("");
  const photoTotal = cleanings.reduce((n, row) => n + row.photoCount, 0);
  const compared = items.filter(item => item.previous && item.previous.photos.length && item.photos.length).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const compareHtml = compared.map(item => compareRow(item, images)).join("");
  const inspectionPhotos = items.filter(item => item.photos.length).sort((a, b) => ORDER[a.status] - ORDER[b.status])
    .flatMap(item => (compared.includes(item) ? item.photos.slice(1) : item.photos).map(photo => inspectionFigure(item, photo, images)));

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><title>정기 관리보고서</title><style>
${Owner.ownerReportStyles(`정기 관리보고서 · ${view.documentNo}`)}
${EXTRA_CSS}
</style></head><body><main>
${coverHtml}<section class="overview">
${hasCover ? "" : `<header class="doc-head">${logo ? `<img class="brand-logo" src="${logo}" alt="BRING CARE">` : '<span class="brand-text">BRING CARE</span>'}<div class="doc-title"><h1>정기 관리보고서</h1><p>BUILDING CARE REPORT</p></div></header>`}
<table class="letter"><tbody>
<tr><th>문서번호</th><td>${escape(view.documentNo)}</td></tr>
<tr><th>수신(건물주)</th><td>${escape(recipient)} 귀하</td></tr>
<tr><th>발신</th><td>${escape(senderLine)}</td></tr>
<tr><th>제목</th><td>${escape(period.label)} 정기 관리 결과 보고 (격주 보고 · 공용부 청소 주 1회 · 건물 정기점검)</td></tr>
</tbody></table>
<section class="dear"><p class="dear-name"><b>${escape(recipient)}</b> 귀하</p><p class="greeting">항상 브링케어를 믿고 소중한 건물을 맡겨 주시는 ${escape(recipient)}님께 진심으로 감사드립니다.\n${escape(period.range)} 귀 건물의 공용부 청소와 정기점검을 아래와 같이 수행하였기에 그 결과를 삼가 보고드립니다.</p></section>
<div class="glance">${glance.map(([label, value]) => `<div><span>${label}</span><b>${escape(value)}</b></div>`).join("")}</div>
<section class="monthly-summary"><h2>이번 기간 요약</h2><p class="greeting">${escape(view.summary)}</p></section>
<section><h2>1. 공용부 청소 내역</h2>${cleanings.length ? `<table class="areas clean"><thead><tr><th>회차</th><th>청소일</th><th>작업 구역</th><th>수행 내용</th><th>사진</th></tr></thead><tbody>${cleanings.map(row => `<tr><td>${row.no}회차<small class="wk">${escape(row.week)}</small></td><td><b class="cdate">${escape(row.shortDate)}</b>${row.workerName ? `<small class="wk">${escape(row.workerName)}</small>` : ""}</td><td>${escape(row.areas)}</td><td>${escape(row.work)}</td><td>${row.photoCount}장</td></tr>`).join("")}</tbody></table>` : '<p class="greeting">이 기간에 등록된 공용부 청소 기록이 없습니다.</p>'}</section>
<section><h2>2. 건물 정기점검 결과</h2><div class="tally">${["good", "watch", "fix", "done"].filter(key => counts[key]).map(key => `${badge(key)} ${counts[key]}건`).join(" ")}${view.inspection.dateLabel ? ` <span>· 점검일 ${escape(view.inspection.dateLabel)}</span>` : ""}</div>
<table class="areas check"><thead><tr><th>No.</th><th>구분</th><th>점검 항목</th><th>상태</th><th>점검 내용</th>${withPhotos ? "<th>사진</th>" : ""}</tr></thead><tbody>${checkRows}</tbody></table></section>
${trackHtml}
${legalHtml}
</section>
${compareHtml ? `<section class="photos part">
<div class="photos-head"><h2>지난 점검과 비교</h2><p>관찰·조치 항목의 같은 위치 · ${compared.length}건</p></div>
${compareHtml}
</section>` : ""}
${inspectionPhotos.length ? `<section class="photos${compareHtml ? "" : " part"}">
<div class="photos-head"><h2>정기점검 사진</h2><p>점검 항목별 현장 확인 · ${inspectionPhotos.length}장</p></div>
<section class="insp-grid">${grid(inspectionPhotos)}</section>
</section>` : ""}
${cleaningPhotos ? `<section class="photos part">
<div class="photos-head"><h2>공용부 청소 사진</h2><p>회차별 · 구역별 · 총 ${photoTotal}장</p></div>
${cleaningPhotos}
</section>` : ""}
<section class="closing">
${view.nextSchedule && view.nextSchedule.length ? `<section><h2>다음 일정</h2><table class="next"><tbody>${view.nextSchedule.map(item => `<tr><td>${escape(item.label)}</td><td>${escape(item.date)}</td></tr>`).join("")}</tbody></table></section>` : ""}
<section class="follow"><h2>추가 안내</h2><p>${escape(view.followUp || (counts.fix ? "조치 필요 항목은 건물주님께서 승인해 주시면 견적과 일정을 따로 안내드리겠습니다. 궁금하신 점이나 추가로 살펴볼 부분은 브링케어로 말씀해 주세요." : "궁금하신 점이나 추가로 살펴볼 부분은 브링케어로 말씀해 주세요."))}</p></section>
<section class="notices">${[...WorkReport.NOTICES, "정기점검은 육안 확인 기준이며, 전문 진단이 필요한 사항은 별도로 안내드립니다."].map(line => `<p>· ${escape(line)}</p>`).join("")}</section>
<p class="thanks">앞으로도 귀 건물을 내 건물처럼 세심하게 살피겠습니다. 궁금하신 점은 언제든 브링케어로 말씀해 주십시오. 감사합니다.</p>
<section class="sender"><p class="date">${escape(today)}</p><div class="from">${logo ? `<img src="${logo}" alt="">` : ""}<b>${escape(sender)} 드림</b><span>문서번호 ${escape(view.documentNo)} · 작성 업체 ${escape(sender)}</span></div></section>
</section>
</main></body></html>`;
}

// PDF 에 실을 사진 목록. 메인 프로세스가 Drive 에서 받아 images 로 넘긴다.
function periodicReportPdfPhotos(view) {
  const photos = [];
  (view.cleanings || []).forEach(row => row.items.forEach(item => ["before", "during", "after"].forEach(phase => item[phase].forEach(photo => photos.push(photo)))));
  if (view.cover && view.cover.photo) photos.push(view.cover.photo);
  ((view.inspection && view.inspection.items) || []).forEach(item => {
    item.photos.forEach(photo => photos.push(photo));
    if (item.previous) item.previous.photos.forEach(photo => photos.push(photo));
  });
  const seen = new Set();
  return photos.filter(photo => photo.id && !seen.has(photo.id) && seen.add(photo.id)).slice(0, 100);
}

module.exports = { createPeriodicReportHtml, periodicReportPdfPhotos };
