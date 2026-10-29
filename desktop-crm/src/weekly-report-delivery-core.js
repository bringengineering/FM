// Shared by the desktop and delivery gateway. Only the public weekly fields are
// projected here: private check-in answers and manager notes never leave CRM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./weekly-report-core'));
  else root.BringWeeklyDeliveryCore = factory(root.BringWeeklyReportCore);
})(typeof globalThis === 'object' ? globalThis : this, function (W) {
  'use strict';
  const fail = () => { throw Object.assign(new Error('주간보고서 제출 내용을 다시 확인해 주세요.'), {code:'INVALID_INPUT'}); };
  const clean = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0,n);
  function reference(record, uid) {
    if (!record || record.uid !== uid || !/^[A-Za-z0-9._-]{1,80}$/.test(record.id || '') || !record.id.startsWith('weekly_report_') || !W.validDate(record.week) || W.weekStart(record.week) !== record.week || !String(record.answers?.done || '').startsWith(W.REPORT_HEADER + '\n') || !String(record.answers?.next || '').startsWith(W.NEXT_HEADER)) fail();
    return {id:record.id, uid, week:record.week, done:record.answers.done, next:record.answers.next};
  }
  function snapshot(source, record, uid) {
    reference(record,uid);
    if (!source || !Array.isArray(source.automatic) || !Array.isArray(source.manual) || !Array.isArray(source.plans) || source.automatic.length>8 || source.manual.length>8 || source.plans.length>10) fail();
    const item = row => {
      if (!row || !clean(row.title,240)) fail();
      const status = Object.hasOwn(W.STATUS_LABELS,row.status) ? row.status : 'in_progress';
      return {title:clean(row.title,240), detail:clean(row.detail,2000), source:clean(row.source,40), status,
        ...(Number.isFinite(row.progress) ? {progress:Math.min(100,Math.max(0,Math.round(row.progress)))} : {})};
    };
    const value = {
      week:record.week, reporter:clean(record.name,80) || '이름 미입력', department:clean(source.department,80) || '브링엔지니어링',
      summary:clean(source.summary,900), automatic:source.automatic.map(item), manual:source.manual.map(item),
      plans:source.plans.map(p => ({title:clean(p.title,240),detail:clean(p.detail,2000),date:W.validDate(p.date)?p.date:'',priority:['높음','보통','낮음'].includes(p.priority)?p.priority:'보통'}))
    };
    if (W.serializeDone(value) !== record.answers.done || W.serializePlans(value.plans) !== record.answers.next) fail();
    return value;
  }
  function caption(report) {
    const all=[...report.automatic,...report.manual];
    return ['주간업무보고서 제출',`${report.reporter} · ${report.week} ~ ${W.addDays(report.week,6)}`,
      `주요 업무 ${all.length}건 · 완료 ${all.filter(x=>x.status==='completed').length}건`, '',clean(report.summary,300),
      '',...all.slice(0,4).map(x=>`• ${clean(x.title,70)} (${W.statusLabel(x)})`),
      '',`다음 주 계획 ${report.plans.length}건 · 전체 세부 내용은 첨부 PDF를 확인해 주세요.`].join('\n').slice(0,1024);
  }
  function fileName(report) {
    const name=clean(report.reporter,40).replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'');
    return `${report.week}_주간업무보고서_${name || '작성자'}.pdf`;
  }
  return {reference,snapshot,caption,fileName};
});
