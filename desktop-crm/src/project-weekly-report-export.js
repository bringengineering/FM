'use strict';
const Core = require('./project-weekly-report-core');

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

function tvProjection(reports) {
  if (!Array.isArray(reports)) return {available:false,approvedReports:null,approvedDone:null,approvedTotal:null};
  const approvedReports=reports.filter(report=>report && report.status==='approved' && report.approvedAt && Core.validateReport(report).ok);
  return {available:true,approvedReports:approvedReports.length,approvedDone:approvedReports.reduce((sum,report)=>sum+report.snapshot.counts.done,0),approvedTotal:approvedReports.reduce((sum,report)=>sum+report.snapshot.counts.total,0)};
}

module.exports={bundle,tvProjection};
