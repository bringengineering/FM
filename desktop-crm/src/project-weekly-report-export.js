(function attachProjectWeeklyReportExport(root,factory){
 const api=factory(typeof module==='object'&&module.exports?require('./project-weekly-report-core'):root.BringProjectWeeklyReportCore);
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BringProjectWeeklyReportExport=api;
})(typeof globalThis==='object'?globalThis:this,function(Core){
'use strict';

function approved(report) {
  if (!report || report.status !== 'approved' || !Core.validateReport(report).ok || !report.approvedAt) throw new Error('승인된 주간 보고서만 내보낼 수 있습니다.');
  return report;
}

function bundle(input) {
  const report = approved(input);
  const snapshot = report.snapshot;
  const sourceOrderIds = snapshot.sources.map(source => source.id);
  return {
    schemaVersion:1,
    reportId:report.id,
    projectId:report.projectId,
    from:snapshot.range.start,
    to:snapshot.range.end,
    assigneeUid:report.authorUid,
    snapshotCounts:{...snapshot.counts},
    sourceOrderIds,
    reports:snapshot.sources.map(source => ({
      sourceId:source.id,
      title:`프로젝트 업무 ${source.id}`,
      assigneeName:'프로젝트 주간 보고',
      status:source.status,
      startDate:snapshot.range.start,
      dueDate:snapshot.range.end,
      what:report.summary || '',
      doneWhen:source.status === 'done' ? '검수 완료' : '상태 확인',
      reviewNote:'',
      report:{summary:report.summary || '',contribution:'',blockers:report.incompleteReason || '',decisionRequest:report.decisionRequests || '',nextAction:report.nextActions || '',metrics:[],evidence:[]},
    })),
    unreported:[],excluded:[],
  };
}

function validApprovalTime(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const stamp=Date.parse(value);
 return Number.isFinite(stamp)?stamp:null;
}

function koreaDate(value){
 const date=value instanceof Date?value:new Date(value);
 if(!Number.isFinite(date.getTime()))return null;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(part=>[part.type,part.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}

function tvProjection(reports,today) {
  const unavailable={available:false,periodStart:null,periodEnd:null,approvedReports:null,approvedTotal:null,approvedDone:null};
  if (!Array.isArray(reports) || typeof today!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return unavailable;
  const date=new Date(`${today}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==today) return unavailable;
  const start=new Date(date);
  start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
  const end=new Date(start);
  end.setUTCDate(end.getUTCDate()+6);
  const periodStart=start.toISOString().slice(0,10);
  const periodEnd=end.toISOString().slice(0,10);
  const latest=new Map();
  for (const report of reports) {
    if (!report || report.status!=='approved' || validApprovalTime(report.approvedAt)===null || !Core.validateReport(report).ok || report.snapshot.range.start!==periodStart || report.snapshot.range.end!==periodEnd) continue;
    const key=`${report.projectId}\u0000${report.authorUid}\u0000${periodStart}`;
    const prior=latest.get(key);
    if (!prior || validApprovalTime(report.approvedAt)>validApprovalTime(prior.approvedAt) || (validApprovalTime(report.approvedAt)===validApprovalTime(prior.approvedAt) && report.id>prior.id)) latest.set(key,report);
  }
  const sources=new Map();
  for (const report of latest.values()) for (const source of report.snapshot.sources) {
    const prior=sources.get(source.id);
    if (!prior || validApprovalTime(report.approvedAt)>validApprovalTime(prior.approvedAt)) sources.set(source.id,{status:source.status,approvedAt:report.approvedAt});
  }
  return {available:true,periodStart,periodEnd,approvedReports:latest.size,approvedTotal:sources.size,approvedDone:[...sources.values()].filter(source=>source.status==='done').length};
}

return {bundle,tvProjection,koreaDate};
});
