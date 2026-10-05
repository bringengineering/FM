'use strict';
const W = require('./weekly-report-core');
const invalid = () => { throw new Error('주간보고서 초안 정보를 다시 확인해 주세요.'); };

function normalize(value) {
  if (!value || !Array.isArray(value.manual) || value.manual.length > 8 || JSON.stringify(value).length > 24000) invalid();
  const manual = value.manual.map((row, index) => {
    if (!row || typeof row.title !== 'string' || !row.title.trim() || !Object.hasOwn(W.STATUS_LABELS, row.status)) invalid();
    return W.normalizeManual(row, index);
  });
  return { manual };
}

function createWeeklyDraftService({ remote, store, marketingOnly = () => false }) {
  return async function handle(action, input) {
    const user = remote.requireOfficeSession();
    if (!['admin', 'member'].includes(user.role) || marketingOnly()) invalid();
    if (!input || input.expectedUid !== user.uid || !W.validDate(input.week) || W.weekStart(input.week) !== input.week || !['load', 'save'].includes(action)) invalid();
    const guard = remote.captureSessionGuard();
    const active = () => remote.sessionGuardActive(guard);
    const scope = { company: `${remote.firebase.databaseUrl}/${remote.databaseRoot || ''}`, uid: user.uid, orderId: input.week };
    if (action === 'load') {
      const result = await store.load(scope, active);
      return result ? { ...result, draft: normalize(result.draft) } : null;
    }
    if (typeof input.baseReport !== 'string' || input.baseReport.length > 16000) invalid();
    return store.save(scope, { baseReport: input.baseReport, draft: normalize(input) }, active);
  };
}
module.exports = { createWeeklyDraftService, normalize };
