'use strict';
const Outcome=require('./work-outcome-core');
const text=value=>typeof value==='string'?value:'';
function date(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const n=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value?n:null;
}
function updated(value){
  if(typeof value!=='string'||date(value.slice(0,10))===null||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return -Infinity;
  const n=Date.parse(value);return Number.isFinite(n)?n:-Infinity;
}
function prepare({orders,assigneeUid,from,to}={}){
  if(!Array.isArray(orders)||!text(assigneeUid).trim()||date(from)===null||date(to)===null||date(from)>date(to))throw new Error('보고 대상 직원과 올바른 시작일·종료일을 지정하세요.');
  const latest=new Map(),reports=[],unreported=[],excluded=[];
  for(const o of orders){
    const id=text(o&&o.id).trim();if(!id)continue;
    if(!latest.has(id)||updated(o.updatedAt)>updated(latest.get(id).updatedAt))latest.set(id,o);
  }
  for(const [id,o] of latest){
    if(o.assigneeUid!==assigneeUid)continue;
    const start=date(o.startDate),end=date(o.dueDate);
    if((o.startDate&&start===null)||(o.dueDate&&end===null)||(start===null&&end===null)||(start!==null&&end!==null&&start>end)){
      excluded.push({sourceId:id,title:text(o.title),reason:'업무 일정 확인 필요'});continue;
    }
    if((start??end)>date(to)||(end??start)<date(from))continue;
    if(!['assigned','doing','submitted','returned','done'].includes(o.status)){
      excluded.push({sourceId:id,title:text(o.title),reason:'업무 상태 확인 필요'});continue;
    }
    const source={sourceId:id,title:text(o.title),assigneeName:text(o.assigneeName),projectId:text(o.projectId),startDate:text(o.startDate),dueDate:text(o.dueDate),updatedAt:text(o.updatedAt),status:o.status,why:text(o.why),what:text(o.what),doneWhen:text(o.doneWhen),reviewNote:text(o.reviewNote)};
    if(o.outcomeReport==null||o.outcomeReport===''){unreported.push({...source,reason:'결과보고 미제출'});continue;}
    try{
      if(typeof o.outcomeReport!=='string'||o.outcomeReport.length>60000)throw new Error();
      const checked=Outcome.validate(JSON.parse(o.outcomeReport));if(!checked.ok)throw new Error();
      reports.push({...source,report:checked.value});
    }catch{unreported.push({...source,reason:'보고서 형식 확인 필요'});}
  }
  const sources=[...reports,...unreported];
  // Renderers use this same immutable-by-convention content for Word and slides.
  // No truncation here: layout must either retain content or explicitly require editing.
  const slides=[
    {title:'이번 주 목표',entries:sources.map(o=>({sourceId:o.sourceId,title:o.title,goal:o.doneWhen,purpose:o.why}))},
    {title:'목표 대비 실적',entries:reports.map(o=>({sourceId:o.sourceId,title:o.title,status:o.status,metrics:o.report.metrics})),unreported:unreported.map(o=>({sourceId:o.sourceId,title:o.title,reason:o.reason}))},
    {title:'주요 결과물',entries:reports.map(o=>({sourceId:o.sourceId,title:o.title,summary:o.report.summary,contribution:o.report.contribution,evidence:o.report.evidence}))},
    {title:'문제와 지원 요청',entries:reports.map(o=>({sourceId:o.sourceId,title:o.title,blockers:o.report.blockers,decisionRequest:o.report.decisionRequest,reviewNote:o.reviewNote}))},
    {title:'다음 행동',entries:reports.map(o=>({sourceId:o.sourceId,title:o.title,nextAction:o.report.nextAction}))}
  ];
  return {schemaVersion:1,assigneeUid,from,to,reports,unreported,excluded,approvedCount:reports.filter(o=>o.status==='done').length,slides};
}
module.exports={prepare};
