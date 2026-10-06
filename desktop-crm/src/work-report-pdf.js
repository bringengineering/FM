"use strict";

// 결과보고서를 종이로 낸다. 인감은 견적서에서만 사용하며 보고서에는
// 인감·날인란을 넣지 않는다.
//
// 두 벌이 나온다.
//
//   건물주 제출용   무엇을 했는지. 사진이 주인공이다.
//   청창사 제출용   용역 보고 서식. 계약기간·사업비·수행업체·항목별 진척도와
//                   결과평가가 있다.
//
// 사진은 data: 로 박는다. 링크로 두면 인쇄할 때 빈 칸이 되고, 건물주가
// 받은 PDF 에서는 아예 안 열린다.

const WorkReportCore = require("./work-report-core");
const { safeFileSegment } = require("./attendance-xlsx");

function html(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

// 사진은 미리 읽어 온 것을 받는다. 여기서 네트워크를 타면 인쇄가 멈춘다.
function photoTag(photo, images) {
  const source = images && images[photo.id];
  if (!source) return `<div class="shot empty">사진 없음</div>`;
  return `<div class="shot"><img src="${html(source)}" alt="${html(photo.caption || "")}"></div>`;
}

function itemRows(report, copyKey) {
  return report.items.filter(item => item.status !== "recorded" || item.before.length + item.during.length + item.after.length || item.note).map((item, index) => {
    const status = WorkReportCore.statusLabel(item.status);
    const weight = (WorkReportCore.statusOf(item.status) || { weight: 0 }).weight;
    const rate = `${Math.round(weight * 100)}%`;
    const detail = item.status === "recorded" ? (item.during.length ? "청소 작업 과정 사진 기록" : "현장 사진 기록") : item.detail;
    // 청창사 서식은 '진척도' 와 '결과평가' 를 요구한다. 건물주용에는 그 대신
    // 무엇을 했는지만 적는다 — 건물주는 퍼센트를 보러 오지 않는다.
    return copyKey === "program"
      ? `<tr><td>${index + 1}</td><td>${html(item.label)}</td><td class="left">${html(item.detail)}</td><td>${html(rate)}</td><td class="left">${html(WorkReportCore.resultLine(item))}</td></tr>`
      : `<tr><td>${index + 1}</td><td>${html(item.label)}</td><td class="left">${html(detail)}</td><td>${html(status)}</td><td class="left">${html(item.note || "")}</td></tr>`;
  }).join("");
}

function photoBoard(report, images) {
  if (report.kind === "common") {
    return report.items.flatMap(item => ["during", "before", "after"].flatMap(phase => {
      const photos = item[phase];
      return Array.from({ length: Math.ceil(photos.length / 4) }, (_, index) => `<section class="board"><h3>${html(item.label)} · ${{ during: "작업 중", before: "작업 전", after: "작업 후" }[phase]}${photos.length > 4 ? ` · ${index + 1}/${Math.ceil(photos.length / 4)}` : ""}</h3><div class="common-photos">${photos.slice(index * 4, index * 4 + 4).map(photo => photoTag(photo, images)).join("")}</div></section>`);
    })).join("") || `<p class="none">붙인 사진이 없습니다.</p>`;
  }
  const blocks = report.items
    .filter(item => item.before.length || item.after.length)
    .flatMap(item => {
      // Keep each print block small enough for A4; never truncate the evidence.
      const count = Math.ceil(Math.max(item.before.length, item.after.length) / 2);
      return Array.from({ length: count }, (_, index) => `<section class="board">
        <h3>${html(item.label)}${count > 1 ? ` · 사진 ${index + 1}/${count}` : ""}</h3>
        <div class="pair">${["before", "after"].map(phase => {
          const photos = item[phase].slice(index * 2, index * 2 + 2);
          return `<div class="cell"><span>${phase === "before" ? "작업 전" : "작업 후"} · 총 ${item[phase].length}장</span>${photos.map(photo => photoTag(photo, images)).join("") || `<div class="shot empty">${item[phase].length ? "이어서 표시할 사진 없음" : "사진 없음"}</div>`}</div>`;
        }).join("")}</div>
      </section>`);
    }).join("");
  return blocks || `<section class="board"><h3>증빙 사진</h3><p class="none">붙인 사진이 없습니다.</p></section>`;
}

function workReportPdfPhotos(report) {
  const photos = report.items.flatMap(item => [...item.before, ...(item.during || []), ...item.after]);
  // Match the picker budget, but reject oversized accumulated reports explicitly.
  if (photos.length > 100) throw Object.assign(new Error("PDF 사진은 보고서당 100장까지 넣을 수 있습니다. 보고서를 나누어 주세요."), { code: "REPORT_PHOTO_LIMIT" });
  return photos;
}

function createWorkReportHtml(input, copyType = "owner", options = {}) {
  const report = WorkReportCore.normalizeReport(input);
  const copy = WorkReportCore.copyOf(copyType);
  if (!copy) throw new Error("보고서 종류를 확인해 주세요.");
  const company = options.company && typeof options.company === "object" ? options.company : {};
  const images = options.images && typeof options.images === "object" ? options.images : {};
  const program = copy.key === "program";
  const color = program ? "#1B5E20" : "#1454D8";
  const light = program ? "#EEF7EE" : "#EFF4FF";
  const summary = WorkReportCore.summarizeItems(report);

  // 쓰던 양식(작업점검_결과보고서_양식)의 1. 기본 정보 칸을 그대로 옮긴다.
  const headRows = [
    ["보고 일자", report.workDate],
    ["문서번호", WorkReportCore.documentNo(report)],
    ["건물명", report.buildingName],
    ["현장 주소", report.siteAddress],
    ["작업·점검 일시", report.workDate],
    ["담당자", report.workerName],
    ["요청자(건물주)", report.ownerName],
    ["연락 방식", report.ownerContact],
    ["작업 종류", WorkReportCore.kindLabel(report.kind)],
    ["작업 범위", report.area],
  ];
  // 청창사 서식은 계약기간과 수행업체를 표지에서 요구한다.
  const programRows = [
    ["계약 기간", report.contractFrom && report.contractTo ? `${report.contractFrom} ~ ${report.contractTo}` : ""],
    ["수행 업체", company.businessName],
    ["대표자", company.representative],
    ["소재지", company.address],
    ["연락처", company.phone],
    ["진척도", `${summary.progress}%`],
  ];
  const infoRows = (program ? [...headRows, ...programRows] : headRows)
    .map(([label, value]) => `<div class="row"><dt>${html(label)}</dt><dd>${html(value || "미기재")}</dd></div>`)
    .join("");

  // 구분은 체크 줄로 낸다. 종이 양식과 같은 모양이라야 받는 쪽이 익숙하다.
  const categoryLine = WorkReportCore.CATEGORIES
    .map(item => {
      const on = item.key === report.category;
      const extra = item.key === "etc" && on && report.categoryEtc ? `(${report.categoryEtc})` : "";
      return `<span class="${on ? "on" : ""}">${on ? "\u2611" : "\u2610"} ${html(item.label)}${html(extra)}</span>`;
    })
    .join("");

  const columns = program
    ? "<th>No.</th><th>항목</th><th>수행범위</th><th>진척도</th><th>결과평가</th>"
    : "<th>No.</th><th>위치·항목</th><th>조치 내용</th><th>상태</th><th>비고</th>";

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${html(copy.title)}</title><style>
@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#252b31;font-family:"Malgun Gothic","맑은 고딕",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.doc{border:1.4px solid ${color}}
.title{display:grid;place-items:center;height:16mm;border-bottom:1.4px solid ${color};color:${color};font-size:20pt;font-weight:800;letter-spacing:.4em;text-indent:.4em}
.brand{display:flex;align-items:center;justify-content:space-between;height:9mm;padding:0 4mm;border-bottom:1px solid ${color};background:${light};color:${color};font-size:8.5pt;font-weight:800}
.info{display:grid;grid-template-columns:1fr 1fr;border-bottom:1.2px solid ${color}}
.row{display:grid;grid-template-columns:26mm 1fr;min-height:7mm;border-bottom:.65px solid ${color}}
.row:nth-child(odd){border-right:.65px solid ${color}}
.row dt,.row dd{display:flex;align-items:center;margin:0;padding:1.2mm 2.5mm}
.row dt{justify-content:center;border-right:.65px solid ${color};background:${light};color:${color};font-size:8pt;font-weight:800}
.row dd{font-size:8.5pt}
.items{width:100%;border-collapse:collapse;table-layout:fixed}
.items th,.items td{border-right:.65px solid ${color};border-bottom:.65px solid ${color};padding:1.4mm;font-size:8pt;text-align:center;vertical-align:middle}
.items td.left{text-align:left}
.items th:last-child,.items td:last-child{border-right:0}
.items thead th{height:8mm;background:${light};color:${color};font-weight:800}
.items th:nth-child(1){width:10mm}.items th:nth-child(2){width:28mm}.items th:nth-child(4){width:18mm}
.summary{display:flex;gap:6mm;padding:2.5mm 4mm;border-bottom:1px solid ${color};background:${light};color:${color};font-size:8.5pt;font-weight:800}
.note{padding:3mm 4mm;border-bottom:1px solid ${color};font-size:8.5pt;line-height:1.6;white-space:pre-wrap}
.boards{padding:3mm 4mm}
.board{margin-bottom:4mm;break-inside:avoid}
.board h3{margin:0 0 1.5mm;color:${color};font-size:9pt}
.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3mm}
.common-photos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3mm}
.cell{display:grid;min-width:0;align-content:start;gap:1.2mm}
.cell>span{color:${color};font-size:7.5pt;font-weight:800}
.shot{display:grid;place-items:center;min-width:0;height:44mm;overflow:hidden;border:.65px solid ${color};border-radius:1.5mm;background:${light}}
.shot img{width:100%;min-width:0;height:100%;object-fit:contain}
.shot.empty{color:#8B95A1;font-size:7.5pt}
.none{color:#8B95A1;font-size:8pt}
.cats{display:flex;flex-wrap:wrap;align-items:center;gap:4mm;padding:2mm 4mm;border-bottom:1px solid ${color};font-size:8pt}
.cats b{color:${color}}
.cats span.on{font-weight:800;color:${color}}
.note h4{margin:0 0 1mm;color:${color};font-size:8.5pt}
.note p{margin:0;white-space:pre-wrap}
.notices{padding:2.5mm 4mm;border-top:.65px solid ${color};background:${light};color:#4E5968;font-size:7pt;line-height:1.6}
.notices p{margin:0 0 .8mm}
.report-footer{display:grid;grid-template-columns:1fr 1fr;min-height:10mm;border-top:1.2px solid ${color}}
.report-footer div{display:flex;align-items:center;justify-content:center;gap:2.5mm;color:${color};font-size:8.5pt;font-weight:800}
.report-footer div:first-child{border-right:.65px solid ${color}}
</style></head><body><main class="doc">
<header class="title">${html(copy.title.split("").join(" "))}</header>
<div class="brand"><span>BRING ENGINEERING</span><span>${html(copy.label)}</span></div>
<section class="info">${infoRows}</section>
<div class="cats"><b>구분</b>${categoryLine}</div>
<div class="summary"><span>항목 ${summary.total}개</span><span>완료 ${summary.done}</span><span>일부 ${summary.partial}</span><span>미실시 ${summary.skipped}</span><span>진척도 ${summary.progress}%</span><span>증빙 사진 ${summary.photos}장</span></div>
<table class="items"><thead><tr>${columns}</tr></thead><tbody>${itemRows(report, copy.key)}</tbody></table>
<section class="note"><h4>발견 사항 및 조치 내용</h4><p>${html(report.summary) || "특이사항 없음"}</p></section>
<section class="note"><h4>후속 필요 사항 · 권고</h4><p>${html(report.followUp) || "없음"}</p></section>
<div class="boards">${photoBoard(report, images)}</div>
<section class="notices">${WorkReportCore.NOTICES.map(line => `<p>\u00b7 ${html(line)}</p>`).join("")}</section>
<footer class="report-footer">
  <div>${html(program ? "수행 업체" : "작성 업체")}&nbsp;&nbsp;${html(company.businessName || company.representative || "")}</div>
  <div>수신(건물주)&nbsp;&nbsp;${html(report.ownerName || "")}</div>
</footer>
</main></body></html>`;
}

function workReportFileName(input, copyType = "owner") {
  const report = WorkReportCore.normalizeReport(input);
  const copy = WorkReportCore.copyOf(copyType);
  if (!copy) throw new Error("보고서 종류를 확인해 주세요.");
  const base = `${report.workDate || "날짜미정"}_${report.buildingName || "건물미정"}_${WorkReportCore.kindLabel(report.kind)}`;
  return `${safeFileSegment(base)}_${copy.label}.pdf`;
}

module.exports = { createWorkReportHtml, workReportFileName, workReportPdfPhotos };
