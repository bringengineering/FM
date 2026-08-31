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

test('app wires the actual marketing commit/archive endpoints and route events', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(app, /MarketingUI\.createEntryController/);
  assert.match(app, /save:\s*payload\s*=>\s*api\.commitMarketingRecord\(payload\)/);
  assert.match(app, /archive:\s*payload\s*=>\s*api\.archiveMarketingRecord\(payload\)/);
  assert.match(app, /data-marketing-entry-form/);
  assert.match(app, /confirmOverwrite/);
  for (const field of ['firstSource', 'lastSource', 'subChannel', 'campaignId', 'campaignName', 'keyword', 'contentId', 'contentTitle', 'inquiryMethod', 'validLead', 'invalidReason', 'firstTouchAt', 'inquiryAt', 'attributionNote']) assert.match(app, new RegExp(`name=["']${field}["']`));
  assert.match(app, /Core\.normalizeMarketingAttribution/);
});
