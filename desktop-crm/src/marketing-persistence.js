'use strict';

const crypto = require('node:crypto');
const MarketingCore = require('./marketing-core');

const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_IDS = new Set(['__proto__', 'prototype', 'constructor']);
const ROOT_FIELDS = new Set(['id', 'requestId', 'expectedVersion', 'action', 'values']);
const VALUE_FIELDS = Object.freeze(['date', 'channel', 'accountName', 'campaignId', 'campaignName', 'adGroup', 'keyword', 'contentId', 'contentTitle', 'service', 'region', 'spend', 'impressions', 'clicks', 'phoneClicks', 'chatClicks', 'directionsClicks', 'saves', 'platformLeads', 'note', 'sourceType']);
const NUMBER_FIELDS = new Set(['spend', 'impressions', 'clicks', 'phoneClicks', 'chatClicks', 'directionsClicks', 'saves', 'platformLeads']);

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exactKeys(value, allowed) { return plain(value) && Object.keys(value).every(key => allowed.has(key)); }
function safeId(value) { return typeof value === 'string' && SAFE_ID.test(value) && !FORBIDDEN_IDS.has(value); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function text(value, limit = 500) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > limit) fail('MARKETING_INPUT_INVALID');
  return value.trim();
}
function integer(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('MARKETING_INPUT_INVALID');
  return value;
}
function normalizeValues(value) {
  if (!exactKeys(value, new Set(VALUE_FIELDS))) fail('MARKETING_INPUT_INVALID');
  let base;
  try { base = MarketingCore.normalizeDaily({ date: value.date, channel: value.channel, spend: value.spend, impressions: value.impressions, clicks: value.clicks, inquiries: value.platformLeads, validLeads: value.platformLeads, service: value.service, region: value.region, keyword: value.keyword }); }
  catch (_) { fail('MARKETING_INPUT_INVALID'); }
  if (!['manual', 'crm'].includes(value.sourceType)) fail('MARKETING_INPUT_INVALID');
  const result = { date: base.date, channel: base.channel };
  for (const name of VALUE_FIELDS) {
    if (name === 'date' || name === 'channel') continue;
    if (NUMBER_FIELDS.has(name)) result[name] = integer(value[name] == null ? 0 : value[name]);
    else if (name === 'sourceType') result[name] = value[name];
    else result[name] = text(value[name], name === 'note' ? 1000 : 200);
  }
  return result;
}
function validateCommitInput(value, expectedAction) {
  if (!exactKeys(value, ROOT_FIELDS) || !safeId(value.id) || !UUID_V4.test(value.requestId || '') || !Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 0) fail('MARKETING_INPUT_INVALID');
  if (!['create', 'update', 'archive'].includes(value.action) || expectedAction && value.action !== expectedAction) fail('MARKETING_INPUT_INVALID');
  if (value.action === 'create' && value.expectedVersion !== 0 || value.action !== 'create' && value.expectedVersion === 0) fail('MARKETING_INPUT_INVALID');
  if (value.action === 'archive') {
    if (Object.hasOwn(value, 'values')) fail('MARKETING_INPUT_INVALID');
    return { id: value.id, requestId: value.requestId.toLowerCase(), expectedVersion: value.expectedVersion, action: value.action };
  }
  if (!Object.hasOwn(value, 'values')) fail('MARKETING_INPUT_INVALID');
  return { id: value.id, requestId: value.requestId.toLowerCase(), expectedVersion: value.expectedVersion, action: value.action, values: normalizeValues(value.values) };
}
function assertMarketingWriter(actor) {
  if (!plain(actor) || actor.active !== true || !safeId(actor.authUid) || !safeId(actor.operatorId) || !(['admin'].includes(actor.accessRole) || actor.accessRole === 'member' && actor.marketingRole === 'marketing')) fail('MARKETING_FORBIDDEN');
  return actor;
}
function assertMarketingReader(actor) {
  if (!plain(actor) || !(actor.accessRole === 'admin' || actor.accessRole === 'member' && actor.marketingRole === 'marketing')) fail('MARKETING_READ_FORBIDDEN');
  return actor;
}
function requestHash(input) { return hash({ id: input.id, requestId: input.requestId, expectedVersion: input.expectedVersion, action: input.action, ...(input.values ? { values: input.values } : {}) }); }
function receiptId(requestId) { return `request_${String(requestId).replace(/-/g, '_')}`; }
function auditId(requestId) { return `audit_${String(requestId).replace(/-/g, '_')}`; }
const SERVER_TIMESTAMP = Object.freeze({ '.sv': 'timestamp' });
function planCommit(inputValue, existing, actorValue, now, existingReceipt) {
  const input = validateCommitInput(inputValue);
  const actor = assertMarketingWriter(actorValue);
  const requestHashValue = requestHash(input);
  if (existingReceipt) {
    const result = existingReceipt.resultRecord;
    if (existingReceipt.requestId !== input.requestId || existingReceipt.requestHash !== requestHashValue || existingReceipt.recordId !== input.id || !plain(result) || result.id !== input.id || result.version !== existingReceipt.afterVersion || result.lastRequestId !== input.requestId || result.lastRequestHash !== requestHashValue) fail('MARKETING_REQUEST_ID_CONFLICT');
    return { record: structuredClone(result), receipt: structuredClone(existingReceipt), repeated: true, requestHash: requestHashValue, auditId: result.lastAuditId };
  }
  if (input.action === 'create' ? existing != null : !existing || existing.version !== input.expectedVersion || existing.archivedAtMs) fail('MARKETING_CONFLICT');
  const aid = auditId(input.requestId);
  const rid = receiptId(input.requestId);
  const immutable = existing ? { createdAtMs: existing.createdAtMs, createdByAuthUid: existing.createdByAuthUid, createdByOperatorId: existing.createdByOperatorId } : { createdAtMs: SERVER_TIMESTAMP, createdByAuthUid: actor.authUid, createdByOperatorId: actor.operatorId };
  const record = { ...(existing || {}), ...(input.values || {}), id: input.id, ...immutable, version: input.expectedVersion + 1, updatedAtMs: SERVER_TIMESTAMP, updatedByAuthUid: actor.authUid, updatedByOperatorId: actor.operatorId, lastAction: input.action, lastAuditId: aid, lastReceiptId: rid, lastRequestId: input.requestId, lastRequestHash: requestHashValue };
  if (input.action === 'archive') Object.assign(record, { archivedAtMs: SERVER_TIMESTAMP, archivedByAuthUid: actor.authUid, archivedByOperatorId: actor.operatorId });
  const audit = { id: aid, actorAuthUid: actor.authUid, operatorId: actor.operatorId, actorIdentifier: text(actor.email || actor.operatorId, 200), action: input.action, recordId: input.id, occurredAtMs: SERVER_TIMESTAMP, beforeVersion: input.expectedVersion, afterVersion: record.version, requestId: input.requestId, requestHash: requestHashValue, beforeSpend: Number(existing && existing.spend || 0), afterSpend: Number(record.spend || 0) };
  const receipt = { id: rid, actorAuthUid: actor.authUid, operatorId: actor.operatorId, action: input.action, recordId: input.id, occurredAtMs: SERVER_TIMESTAMP, beforeVersion: input.expectedVersion, afterVersion: record.version, requestId: input.requestId, requestHash: requestHashValue, resultRecord: structuredClone(record) };
  return { record, audit, receipt, repeated: false, requestHash: requestHashValue, auditId: aid };
}
function readEnvelope(daily) {
  const active = [], archived = [];
  for (const source of Object.values(plain(daily) ? daily : {})) {
    const record = structuredClone(source);
    for (const [ms, iso] of [['createdAtMs', 'createdAt'], ['updatedAtMs', 'updatedAt'], ['archivedAtMs', 'archivedAt']]) if (Number.isSafeInteger(record[ms]) && record[ms] >= 0) record[iso] = new Date(record[ms]).toISOString();
    (record && record.archivedAtMs ? archived : active).push(record);
  }
  const times = active.concat(archived).map(item => String(item.updatedAt || '')).filter(Boolean).sort();
  return { daily: active, archived, lastUpdatedAt: times.at(-1) || '' };
}

function createLocalPersistence(options) {
  const state = options.state;
  let queue = Promise.resolve(), lastTime = 0;
  const sessionKey = session => session && `${String(session.uid || '')}|${String(session.email || '')}|${String(session.role || '')}|${String(session.marketingRole || '')}`;
  const resolveTime = (value, timestamp) => JSON.parse(JSON.stringify(value), (_key, item) => item && item['.sv'] === 'timestamp' ? timestamp : item);
  async function commit(inputValue) {
    const queuedKey = sessionKey(options.getSession());
    const running = queue.then(async () => {
      const session = options.getSession();
      if (!queuedKey || sessionKey(session) !== queuedKey) fail('SESSION_CHANGED');
      const input = validateCommitInput(inputValue);
      const actor = assertMarketingWriter(options.resolveActor(session));
      const rid = receiptId(input.requestId);
      const plan = planCommit(input, state.daily[input.id] || null, actor, null, state.receipts[rid] || null);
      if (plan.repeated) return { record: (readEnvelope({ [input.id]: plan.record }).daily[0] || readEnvelope({ [input.id]: plan.record }).archived[0]), repeated: true, auditId: plan.auditId };
      const timestamp = Math.max(Number(options.clock()), lastTime + 1);
      if (!Number.isSafeInteger(timestamp) || timestamp < 0 || sessionKey(options.getSession()) !== queuedKey) fail('SESSION_CHANGED');
      const record = resolveTime(plan.record, timestamp), audit = resolveTime(plan.audit, timestamp), receipt = resolveTime(plan.receipt, timestamp);
      const previous = { record: state.daily[input.id], audit: state.audits[audit.id], receipt: state.receipts[rid] };
      state.daily[input.id] = record; state.audits[audit.id] = audit; state.receipts[rid] = receipt;
      if (sessionKey(options.getSession()) !== queuedKey) {
        for (const [bucket, key, value] of [['daily', input.id, previous.record], ['audits', audit.id, previous.audit], ['receipts', rid, previous.receipt]]) value === undefined ? delete state[bucket][key] : state[bucket][key] = value;
        fail('SESSION_CHANGED');
      }
      lastTime = timestamp;
      const envelope = readEnvelope({ [input.id]: record });
      return { record: envelope.daily[0] || envelope.archived[0], repeated: false, auditId: audit.id };
    });
    queue = running.catch(() => {});
    return running;
  }
  return Object.freeze({ commit, read: () => readEnvelope(state.daily) });
}

module.exports = Object.freeze({ VALUE_FIELDS, SERVER_TIMESTAMP, validateCommitInput, assertMarketingWriter, assertMarketingReader, requestHash, receiptId, auditId, planCommit, readEnvelope, createLocalPersistence });
