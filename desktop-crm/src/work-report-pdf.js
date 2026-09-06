"use strict";

// 결과보고서를 종이로 낸다. 견적서와 같은 길을 쓴다 — 같은 인감, 같은
// 저장 경로, 같은 생김새다. 서식이 회사마다 다르면 받는 사람은 그걸 먼저
// 의심한다.
//
// 두 벌이 나온다.
//
//   건물주 제출용   무엇을 했는지. 사진이 주인공이다.
//   청창사 제출용   용역 보고 서식. 계약기간·사업비·수행업체·항목별 진척도와
//                   결과평가가 있고, 표지에 대표자 날인이 들어간다.
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

function spacedDisplayName(value) {
  return Array.from(String(value || "").replace(/\s+/g, "")).join(" ");
}

// 견적서와 같은 검사다. 인감이 아닌 것이 들어오면 문서가 통째로 못 믿을
// 것이 된다.
function sealDataUrl(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.length || buffer.length > 512 * 1024 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error("보고서 인감 이미지는 512KB 이하 PNG 파일이어야 합니다.");
  }
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

// 사진은 미리 읽어 온 것을 받는다. 여기서 네트워크를 타면 인쇄가 멈춘다.
function photoTag(photo, images) {
  const source = images && images[photo.id];
  if (!source) return `<div class="shot empty">사진 없음</div>`;
  return `<div class="shot"><img src="${html(source)}" alt="${html(photo.caption || "")}"></div>`;
}

function itemRows(report, copyKey) {
  return report.items.map((item, index) => {
    const status = WorkReportCore.statusLabel(item.status);
    const weight = (WorkReportCore.statusOf(item.status) || { weight: 0 }).weight;
    const rate = `${Math.round(weight * 100)}%`;
    // 청창사 서식은 '진척도' 와 '결과평가' 를 요구한다. 건물주용에는 그 대신
    // 무엇을 했는지만 적는다 — 건물주는 퍼센트를 보러 오지 않는다.
    return copyKey === "program"
      ? `<tr><td>${index + 1}</td><td>${html(item.label)}</td><td class="left">${html(item.detail)}</td><td>${html(rate)}</td><td class="left">${html(WorkReportCore.resultLine(item))}</td></tr>`
      : `<tr><td>${index + 1}</td><td>${html(item.label)}</td><td class="left">${html(item.detail)}</td><td>${html(status)}</td><td class="left">${html(item.note || "")}</td></tr>`;
  }).join("");
}

function photoBoard(report, images) {
  const blocks = report.items
    .filter(item => item.before.length || item.after.length)
    .map(item => `<section class="board">
      <h3>${html(item.label)}</h3>
      <div class="pair">
        <div class="cell"><span>작업 전</span>${item.before.slice(0, 2).map(photo => photoTag(photo, images)).join("") || `<div class="shot empty">사진 없음</div>`}</div>
        <div class="cell"><span>작업 후</span>${item.after.slice(0, 2).map(photo => photoTag(photo, images)).join("") || `<div class="shot empty">사진 없음</div>`}</div>
      </div>
    </section>`).join("");
  return blocks || `<section class="board"><h3>증빙 사진</h3><p class="none">붙인 사진이 없습니다.</p></section>`;
}

function createWorkReportHtml(input, copyType = "owner", options = {}) {
  const report = WorkReportCore.normalizeReport(input);
  const copy = WorkReportCore.copyOf(copyType);
  if (!copy) throw new Error("보고서 종류를 확인해 주세요.");
  const company = options.company && typeof options.company === "object" ? options.company : {};
  const images = options.images && typeof options.images === "object" ? options.images : {};
  const seal = sealDataUrl(options.sealImage);
  const program = copy.key === "program";
  const color = program ? "#1B5E20" : "#1454D8";
  const light = program ? "#EEF7EE" : "#EFF4FF";
  const summary = WorkReportCore.summarizeItems(report);
  const representative = spacedDisplayName(company.representative);

  const headRows = [
    ["건물명", report.buildingName],
    ["현장 주소", report.siteAddress],
    ["작업 종류", WorkReportCore.kindLabel(report.kind)],
    ["작업 일자", report.workDate],
    ["작업 인원", report.workerName],
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

  const columns = program
    ? "<th>No.</th><th>항목</th><th>수행범위</th><th>진척도</th><th>결과평가</th>"
    : "<th>No.</th><th>항목</th><th>작업 내용</th><th>상태</th><th>비고</th>";

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
.pair{display:grid;grid-template-columns:1fr 1fr;gap:3mm}
.cell{display:grid;gap:1.2mm}
.cell>span{color:${color};font-size:7.5pt;font-weight:800}
.shot{display:grid;place-items:center;height:44mm;overflow:hidden;border:.65px solid ${color};border-radius:1.5mm;background:${light}}
.shot img{width:100%;height:100%;object-fit:cover}
.shot.empty{color:#8B95A1;font-size:7.5pt}
.none{color:#8B95A1;font-size:8pt}
.sign{display:grid;grid-template-columns:1fr 1fr;min-height:14mm;border-top:1.2px solid ${color}}
.sign div{display:flex;align-items:center;justify-content:center;gap:2.5mm;color:${color};font-size:8.5pt;font-weight:800}
.sign div:first-child{border-right:.65px solid ${color}}
.sign img{width:11mm;height:11mm;object-fit:contain}
</style></head><body><main class="doc">
<header class="title">${html(copy.title.split("").join(" "))}</header>
<div class="brand"><span>BRING ENGINEERING</span><span>${html(copy.label)}</span></div>
<section class="info">${infoRows}</section>
<div class="summary"><span>항목 ${summary.total}개</span><span>완료 ${summary.done}</span><span>일부 ${summary.partial}</span><span>미실시 ${summary.skipped}</span><span>진척도 ${summary.progress}%</span><span>증빙 사진 ${summary.photos}장</span></div>
<table class="items"><thead><tr>${columns}</tr></thead><tbody>${itemRows(report, copy.key)}</tbody></table>
${report.summary ? `<section class="note">${html(report.summary)}</section>` : ""}
<div class="boards">${photoBoard(report, images)}</div>
<footer class="sign">
  <div>작성일&nbsp;&nbsp;${html(report.workDate)}</div>
  <div>${html(program ? "수행업체 대표자" : "작업 확인")}&nbsp;&nbsp;${html(representative || company.businessName || "")}<img src="${seal}" alt="대표자 날인"></div>
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

module.exports = { createWorkReportHtml, workReportFileName };
