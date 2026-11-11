'use strict';
const W=require('./weekly-report-core');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function weeklyReportPdfHtml(report, logo='') {
  if(logo && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(logo)) throw new Error('INVALID_LOGO');
  const rows=[...report.automatic,...report.manual];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>주간업무보고서</title><style>
  @page{size:A4;margin:14mm 16mm}*{box-sizing:border-box}body{font-family:'Malgun Gothic',sans-serif;color:#111;font-size:11pt;line-height:1.5;margin:0;overflow-wrap:anywhere}
  header{border-bottom:3px solid #15599c;padding-bottom:10px;display:flex;justify-content:space-between;align-items:center}header img{width:56px;height:56px;object-fit:contain}.brand{color:#15599c;font-weight:700;font-size:10pt;letter-spacing:1px}h1{font-size:22pt;line-height:1.2;margin:6px 0}h2{font-size:14pt;color:#15599c;margin:16px 0 8px;break-after:avoid}h3{font-size:12pt;margin:0 0 5px;break-after:avoid}.meta{margin:10px 0;color:#333}.summary{background:#f0f6fc;border-left:4px solid #15599c;padding:10px 14px;white-space:pre-wrap}.item{border:1px solid #d8e2ec;border-radius:6px;padding:8px 13px;margin:0 0 8px;break-inside:avoid}.detail{white-space:pre-wrap;margin:5px 0 0}.label{color:#444;font-size:9pt}.status{float:right;color:#15599c;font-size:10pt;font-weight:bold}.empty{color:#444}footer{border-top:1px solid #d8e2ec;margin-top:16px;padding-top:8px;color:#555;font-size:9pt}
  </style></head><body><header><div><div class="brand">BRING ENGINEERING</div><h1>주간업무보고서</h1><div>${esc(report.week)} ~ ${esc(W.addDays(report.week,6))}</div></div>${logo?`<img src="${logo}" alt="브링엔지니어링">`:''}</header>
  <div class="meta">작성자 <b>${esc(report.reporter)}</b> · ${esc(report.department)} &nbsp; | &nbsp; 주요 업무 ${rows.length}건</div>
  <h2>이번 주 업무 요약</h2><div class="summary">${esc(report.summary || W.defaultSummary(report.automatic,report.manual))}</div>
  <h2>이번 주 주요 업무 · 세부사항</h2>${rows.map((x,i)=>`<section class="item"><span class="status">${esc(W.statusLabel(x))}</span><h3>${i+1}. ${esc(x.title)}</h3><div class="label">${esc(x.source||'직접 추가')}</div>${x.detail?`<p class="detail">${esc(x.detail)}</p>`:''}</section>`).join('')||'<p class="empty">등록된 업무가 없습니다.</p>'}
  <h2>다음 주 계획 · 직접 작성</h2>${report.plans.map((x,i)=>`<section class="item"><h3>${i+1}. ${esc(x.title)}</h3><div class="label">중요도 ${esc(x.priority)}${x.date?` · ${esc(x.date)}`:''}</div>${x.detail?`<p class="detail">${esc(x.detail)}</p>`:''}</section>`).join('')||'<p class="empty">작성한 다음 주 계획이 없습니다.</p>'}
  <footer>브링엔지니어링 · CRM 최종 제출 내용으로 작성한 보고서입니다.</footer></body></html>`;
}
module.exports={weeklyReportPdfHtml};
