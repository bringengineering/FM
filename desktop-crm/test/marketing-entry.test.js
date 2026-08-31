'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/marketing-core');
const UI = require('../src/marketing-ui');
const CrmCore = require('../src/core');
const fs = require('node:fs');
const path = require('node:path');

const base = { date: '2026-08-31', channel: 'naver_blog', campaignName: ' Summer  Sale ', keyword: ' Civil   Engineer ', spend: 1 };

test('manual input normalizes bounded fields and exact duplicate identity', () => {
  const row = Core.normalizeManualRecord(base);
  assert.equal(row.sourceType, 'manual');
  assert.equal(Core.duplicateKey(row), '2026-08-31|naver_blog|summer sale|civil engineer');
  assert.equal(Core.duplicateKey({ ...row, campaignId: 'ID-1', campaignName: '' }), '2026-08-31|naver_blog|id-1|civil engineer');
});

test('manual input rejects invalid dates, fractional, unsafe, and negative counts', () => {
  for (const values of [
    { ...base, date: '2026-02-30' }, { ...base, clicks: 1.5 },
    { ...base, spend: -1 }, { ...base, impressions: Number.MAX_SAFE_INTEGER + 1 }
  ]) assert.throws(() => Core.normalizeManualRecord(values));
});

test('duplicate search excludes archived rows and ignores harmless whitespace/case', () => {
  const proposed = Core.normalizeManualRecord(base);
  const active = { id: 'a', version: 2, ...Core.normalizeManualRecord({ ...base, campaignName: 'summer sale', keyword: 'CIVIL engineer' }) };
  assert.equal(Core.findActiveDuplicate([active, { ...active, id: 'old', archivedAtMs: 1 }], proposed).id, 'a');
  assert.equal(Core.findActiveDuplicate([{ ...active, archivedAtMs: 1 }], proposed), null);
});

test('attribution uses closed choices and valid lead transitions', () => {
  assert.deepEqual(Core.normalizeMarketingAttribution({ validLead: true, invalidReason: 'spam', inquiryMethod: 'phone' }), { inquiryMethod: 'phone', validLead: true });
  assert.throws(() => Core.normalizeMarketingAttribution({ validLead: false }), /invalidReason/);
  assert.deepEqual(Core.normalizeMarketingAttribution({ validLead: null, inquiryMethod: 'bogus' }), { inquiryMethod: 'needs_review', validLead: null });
});

test('customer attribution roundtrips legacy-safe without private or AI fields', () => {
  assert.deepEqual(CrmCore.normalizeCustomer({ id: 'legacy' }).marketing, {});
  const customer = CrmCore.normalizeCustomer({ id: 'c', notes: 'private', marketing: { inquiryMethod: 'talktalk', validLead: false, invalidReason: 'spam', attributionNote: 'marketing', privateNote: 'leak', aiPrompt: 'leak' } });
  assert.deepEqual(customer.marketing, { inquiryMethod: 'talktalk', validLead: false, invalidReason: 'spam', attributionNote: 'marketing' });
  assert.throws(() => CrmCore.normalizeCustomer({ marketing: { validLead: false } }), /invalidReason/);
});

test('entry controller reviews duplicates, preserves opened version, and refreshes only after commit', async () => {
  let release;
  const calls = [], reads = [];
  const existing = { id: 'existing', version: 4, ...Core.normalizeManualRecord(base) };
  const controller = UI.createEntryController({
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
    read: async () => { reads.push(1); return { daily: [existing], archived: [], lastUpdatedAt: 'now' }; },
    save: payload => new Promise(resolve => { calls.push(payload); release = resolve; }),
    archive: async payload => { calls.push(payload); return { record: { ...existing, archivedAtMs: 2 } }; }
  });
  await controller.refresh();
  const review = await controller.submit(base);
  assert.equal(review.status, 'duplicate_review');
  const pending = controller.confirmOverwrite();
  assert.equal(calls[0].id, 'existing');
  assert.equal(calls[0].expectedVersion, 4);
  assert.equal(calls[0].action, 'update');
  assert.match(calls[0].requestId, /^[0-9a-f-]{36}$/);
  assert.equal(reads.length, 1, 'must not optimistically refresh or report success');
  release({ record: { ...existing, version: 5 } });
  await pending;
  assert.equal(reads.length, 2);
});

test('copy creates id/version/request-free draft with a new date and archive is soft', async () => {
  const calls = [];
  const row = { id: 'r1', version: 3, requestId: 'secret', lastRequestId: 'secret2', ...Core.normalizeManualRecord(base) };
  const controller = UI.createEntryController({ read: async () => ({ daily: [row], archived: [] }), save: async p => (calls.push(p), { record: p }), archive: async p => (calls.push(p), { record: p }), uuid: () => '00000000-0000-4000-8000-000000000001' });
  await controller.refresh();
  const draft = controller.copy(row, '2026-09-01');
  assert.equal(draft.date, '2026-09-01');
  for (const name of ['id', 'version', 'requestId', 'lastRequestId']) assert.equal(draft[name], undefined);
  await controller.archive(row);
  assert.deepEqual(calls[0], { id: 'r1', expectedVersion: 3, requestId: '00000000-0000-4000-8000-000000000001', action: 'archive' });
});

test('input route hides write controls from non writers and renders archived audit read-only', () => {
  const html = UI.renderMarketingInput({ canWrite: false, active: [{ id: 'a', date: '2026-08-31', channel: 'naver_blog' }], archived: [{ id: 'z', date: '2026-08-30', channel: 'soomgo', archivedByOperatorId: '<x>' }], lastUpdatedAt: '2026-08-31T01:00:00Z' });
  assert.doesNotMatch(html, /data-marketing-add/);
  assert.match(html, /보관된 기록/);
  assert.match(html, /&lt;x&gt;/);
  assert.doesNotMatch(html, /hard-delete|data-marketing-delete/);
});

test('input rows escape safe actor labels and show explicit loading error and empty states', () => {
  const loading = UI.renderMarketingInput({ canWrite: true, loading: true, active: [], archived: [] });
  assert.match(loading, /불러오는 중/); assert.doesNotMatch(loading, /data-marketing-add/);
  const failed = UI.renderMarketingInput({ error: '<failed>', active: [], archived: [] });
  assert.match(failed, /&lt;failed&gt;/); assert.match(failed, /다시 시도/); assert.doesNotMatch(failed, /활성 기록이 없습니다/);
  const row = UI.renderMarketingInput({ active: [{ id: 'a', date: '2026-08-31', channel: 'naver_blog', createdByOperatorId: '<actor>', createdAt: '2026-08-31T01:00:00Z' }], archived: [] });
  assert.match(row, /&lt;actor&gt;/); assert.doesNotMatch(row, /createdByAuthUid/);
});

test('refresh failures remain entry-local and a successful retry clears the error', async () => {
  let fail = true;
  const controller = UI.createEntryController({ read: async () => { if (fail) throw new Error('offline'); return { daily: [], archived: [] }; }, save: async () => ({}), archive: async () => ({}) });
  const first = await controller.refresh();
  assert.equal(first.error, 'offline'); assert.equal(first.loading, false);
  fail = false; await controller.refresh();
  assert.equal(controller.state.error, ''); assert.equal(controller.state.loaded, true);
});

test('archived or missing current conflict cannot be overwritten', async () => {
  let commits = 0;
  const existing = { id: 'gone', version: 2, ...Core.normalizeManualRecord(base) };
  const controller = UI.createEntryController({ read: async () => ({ daily: [], archived: [{ ...existing, archivedAtMs: 3 }] }), save: async () => { commits++; const error = new Error('MARKETING_CONFLICT'); error.code = 'MARKETING_CONFLICT'; throw error; }, archive: async () => ({}) , uuid: () => '00000000-0000-4000-8000-000000000001' });
  controller.state.active = [existing];
  const result = await controller.submit(base, existing);
  assert.equal(result.status, 'conflict_unavailable');
  assert.match(controller.state.review.message, /보관되었거나 존재하지 않아/);
  await assert.rejects(() => controller.confirmOverwrite(), /cannot be overwritten/);
  assert.equal(commits, 1);
});

test('production and canonical marketing conflict codes require the same re-review', async () => {
  for (const code of ['MARKETING_VERSION_CONFLICT', 'CANONICAL_VERSION_CONFLICT']) {
    const existing = { id: 'm1', version: 3, date: '2026-08-30', channel: 'naver_place_ads', campaignName: 'A', keyword: 'K' };
    const controller = UI.createEntryController({ read: async () => ({ daily: [existing], archived: [] }), save: async () => { const error = new Error(code); error.code = code; throw error; }, archive: async () => ({}), uuid: () => '00000000-0000-4000-8000-000000000001' });
    await controller.refresh();
    const result = await controller.submit({ ...existing, spend: 2 }, existing);
    assert.equal(result.status, 'conflict_review');
    assert.equal(controller.state.review.openedVersion, 3);
  }
});

test('archive and overwrite failures stay local with saving cleared and later success clears error', async () => {
  const row = { id: 'r', version: 2, ...Core.normalizeManualRecord(base) };
  let failArchive = true, failSave = true;
  const controller = UI.createEntryController({ read: async () => ({ daily: [row], archived: [] }), archive: async () => { if (failArchive) throw new Error('archive offline'); return {}; }, save: async () => { if (failSave) throw new Error('save offline'); return {}; }, uuid: () => '00000000-0000-4000-8000-000000000001' });
  await controller.refresh();
  const archived = await controller.archive(row);
  assert.equal(archived.status, 'error'); assert.equal(controller.state.error, 'archive offline'); assert.equal(controller.state.saving, false);
  failArchive = false; await controller.archive(row); assert.equal(controller.state.error, '');
  controller.state.review = { type: 'duplicate', existing: row, openedVersion: 2, proposed: Core.normalizeManualRecord(base) };
  const overwritten = await controller.confirmOverwrite();
  assert.equal(overwritten.status, 'error'); assert.equal(controller.state.error, 'save offline'); assert.equal(controller.state.saving, false);
  failSave = false; await controller.confirmOverwrite(); assert.equal(controller.state.error, '');
});

test('role-aware customer and case submissions allow-list marketing-only payloads', () => {
  const marketingUser = { accessRole: 'member', marketingRole: 'marketing' };
  const salesUser = { accessRole: 'member', marketingRole: 'sales' };
  const viewer = { accessRole: 'viewer' };
  const existing = { id: 'c', name: 'Original', phone: '010', notes: 'private', marketing: { firstSource: 'referral' } };
  const forged = { name: 'FORGED', phone: '999', notes: 'LEAK', marketing: { firstSource: 'naver_blog', validLead: true, invalidReason: 'spam' } };
  assert.deepEqual(UI.crmEditPermissions(marketingUser), { core: false, attribution: true });
  assert.deepEqual(UI.buildRoleLimitedEntityUpdate('customer', existing, forged, marketingUser), { id: 'c', marketing: { firstSource: 'naver_blog', validLead: true } });
  assert.equal(UI.buildRoleLimitedEntityUpdate('customer', existing, forged, salesUser).name, 'FORGED');
  assert.throws(() => UI.buildRoleLimitedEntityUpdate('case', existing, forged, viewer), /forbidden/);
  assert.throws(() => UI.buildRoleLimitedEntityUpdate('case', existing, { marketing: { validLead: false } }, marketingUser), /invalidReason/);
});

test('role-limited submit harness executes save with normalized allow-listed payload', async () => {
  const calls = [];
  const existing = { id: 'case-1', name: 'Keep', phone: '010', marketing: {} };
  const result = await UI.submitRoleLimitedEntityUpdate({ kind: 'case', existing, submitted: { name: 'FORGED', marketing: { firstSource: 'naver_blog', validLead: true, invalidReason: 'spam' } }, user: { accessRole: 'member', marketingRole: 'marketing' }, save: async payload => { calls.push(payload); return { ok: true }; } });
  assert.deepEqual(calls, [{ id: 'case-1', marketing: { firstSource: 'naver_blog', validLead: true } }]);
  assert.equal(result.ok, true);
});

test('attribution CAS conflict preserves draft and returns a mandatory server comparison', async () => {
  const draft = { keyword: 'draft' };
  const result = await UI.submitRoleLimitedEntityUpdate({ kind: 'customer', existing: { id: 'c1' }, submitted: { marketing: draft }, user: { accessRole: 'member', marketingRole: 'marketing' }, save: async () => { const error = new Error('conflict'); error.code = 'MARKETING_ATTRIBUTION_CONFLICT'; error.currentMarketing = { keyword: 'server' }; throw error; } });
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.deepEqual(result.draftMarketing, draft);
  assert.deepEqual(result.currentMarketing, { keyword: 'server' });
  assert.match(result.error, /재검토/);
  const resolved = await UI.submitRoleLimitedEntityUpdate({ kind: 'case', existing: { id: 'case1' }, submitted: { marketing: draft }, user: { accessRole: 'member', marketingRole: 'marketing' }, save: async () => ({ ok: false, code: 'MARKETING_ATTRIBUTION_CONFLICT', currentMarketing: { keyword: 'newer' } }) });
  assert.equal(resolved.conflict, true);
  assert.deepEqual(resolved.currentMarketing, { keyword: 'newer' });
});

test('production submission policy blocks forged generic forms for marketing-only role', () => {
  const marketing = { accessRole: 'member', marketingRole: 'marketing' };
  assert.equal(UI.roleSubmissionPolicy(marketing, 'customerForm').allowed, false);
  assert.equal(UI.roleSubmissionPolicy(marketing, 'workflowCaseBasicForm').allowed, false);
  assert.equal(UI.roleSubmissionPolicy(marketing, 'workflowCaseCreateForm').allowed, false);
  assert.equal(UI.roleSubmissionPolicy(marketing, 'customerMarketingForm').allowed, true);
  assert.equal(UI.roleSubmissionPolicy(marketing, 'caseMarketingForm').allowed, true);
  assert.equal(UI.roleSubmissionPolicy({ accessRole: 'viewer' }, 'customerMarketingForm').allowed, false);
});

test('app wires the actual marketing commit/archive endpoints and route events', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(app, /MarketingUI\.createEntryController/);
  assert.match(app, /save:\s*payload\s*=>\s*api\.commitMarketingRecord\(payload\)/);
  assert.match(app, /archive:\s*payload\s*=>\s*api\.archiveMarketingRecord\(payload\)/);
  assert.match(app, /data-marketing-entry-form/);
  assert.match(app, /confirmOverwrite/);
  for (const field of ['firstSource', 'lastSource', 'subChannel', 'campaignId', 'campaignName', 'keyword', 'contentId', 'contentTitle', 'inquiryMethod', 'validLead', 'invalidReason', 'firstTouchAt', 'inquiryAt', 'attributionNote']) assert.match(app, new RegExp(`name=["']${field}["']`));
  assert.match(app, /Core\.normalizeMarketingAttribution/);
  assert.match(app, /function marketingAttributionFields/);
  assert.match(app, /workflowCaseBasicForm[\s\S]*marketingAttributionFields\(item\.marketing/);
  assert.match(app, /parseMarketingAttribution\(raw\)/);
});
