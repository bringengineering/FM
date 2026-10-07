'use strict';
// Deterministic excerpts for documents/presentations, never AI-inferred outcomes.
function excerpt(value,limit=180){
 const points=Array.from(String(value??'').replace(/\s+/g,' ').trim());
 const shortened=points.length>limit;
 return {text:shortened?points.slice(0,limit-1).join('')+'…':points.join(''),shortened};
}
function prepare(bundle){
 if(!bundle||bundle.schemaVersion!==1||!['reports','unreported','excluded'].every(key=>Array.isArray(bundle[key])))throw new Error('보고 자료를 다시 불러오세요.');
 const {reports,unreported,excluded}=bundle;
 const sources=[...reports,...unreported];
 const item=(o,value,extra={})=>({sourceId:o.sourceId,title:excerpt(o.title,60).text,...excerpt(value,180),...extra});
 const section=(title,rows)=>({title,items:rows.slice(0,3),omittedCount:Math.max(0,rows.length-3)});
 const slides=[
  section('이번 주 목표',sources.map(o=>item(o,o.doneWhen||'완료 기준 미기재'))),
  section('목표 대비 실적',sources.map(o=>item(o,o.report?'정량 지표와 업무 상태':o.reason,{status:o.status||'',metrics:o.report?o.report.metrics.slice(0,2).map(m=>({...m})):[],omittedMetrics:o.report?Math.max(0,o.report.metrics.length-2):0}))),
  section('주요 결과물',reports.map(o=>item(o,o.report.summary,{contribution:excerpt(o.report.contribution,90),evidenceCount:o.report.evidence.length}))),
  section('문제와 지원 요청',reports.filter(o=>o.report.blockers||o.report.decisionRequest||o.reviewNote).map(o=>item(o,[o.report.blockers&&'미완료 사항: '+o.report.blockers,o.report.decisionRequest&&'지원 요청: '+o.report.decisionRequest,o.reviewNote&&'검수 의견: '+o.reviewNote].filter(Boolean).join('\n')))),
  section('다음 행동',reports.filter(o=>o.report.nextAction).map(o=>item(o,o.report.nextAction)))
 ];
 return {
  totalOrders:sources.length,approvedCount:reports.filter(o=>o.status==='done').length,reportCount:reports.length,
  unreportedCount:unreported.length,excludedCount:excluded.length,
  unreported:unreported.slice(0,3).map(o=>item(o,o.reason)),excluded:excluded.slice(0,3).map(o=>item(o,o.reason)),
  notice:'각 항목은 원본 순서의 최대 3개 업무를 발췌합니다. 줄인 문장은 …로 표시하며, 전체 내용과 증빙은 부록의 업무 ID로 확인하세요.',
  slides,pages:[{title:'담당업무와 정량 실적',sections:[slides[0],slides[1]]},{title:'주요 결과와 기여',sections:[slides[2]]},{title:'문제와 다음 행동',sections:[slides[3],slides[4]]}]
 };
}
module.exports={prepare,excerpt};
