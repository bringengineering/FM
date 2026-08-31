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
  if (!plain(actor) || actor.active !== true || !safeId(actor.authUid) || !safeId(actor.operatorId) || !['admin', 'marketing'].includes(actor.role)) fail('MARKETING_FORBIDDEN');
  return actor;
}
function requestHash(input) { return hash({ id: input.id, requestId: input.requestId, expectedVersion: input.expectedVersion, action: input.action, ...(input.values ? { values: input.values } : {}) }); }
function receiptId(requestId) { return `request_${String(requestId).replace(/-/g, '_')}`; }
function auditId(requestId) { return `audit_${String(requestId).replace(/-/g, '_')}`; }
function snapshot(record) {
  if (!record) return null;
  return Object.fromEntries(['date', 'channel', 'campaignId', 'campaignName', 'service', 'region', ...NUMBER_FIELDS].map(key => [key, record[key] == null ? '' : record[key]]));
}
function planCommit(inputValue, existing, actorValue, now, existingReceipt) {
  const input = validateCommitInput(inputValue);
  const actor = assertMarketingWriter(actorValue);
  const requestHashValue = requestHash(input);
  if (existingReceipt) {
    if (existingReceipt.requestId !== input.requestId || existingReceipt.requestHash !== requestHashValue || existingReceipt.recordId !== input.id || !existingReceipt.record) fail('MARKETING_REQUEST_ID_CONFLICT');
    return { record: structuredClone(existingReceipt.record), receipt: structuredClone(existingReceipt), repeated: true, requestHash: requestHashValue, auditId: existingReceipt.auditId };
  }
  if (input.action === 'create' ? existing != null : !existing || existing.version !== input.expectedVersion || existing.archivedAt) fail('MARKETING_CONFLICT');
  const timestamp = new Date(now).toISOString();
  const immutable = existing ? { createdAt: existing.createdAt, createdByAuthUid: existing.createdByAuthUid, createdByOperatorId: existing.createdByOperatorId } : { createdAt: timestamp, createdByAuthUid: actor.authUid, createdByOperatorId: actor.operatorId };
  const record = { ...(existing || {}), ...(input.values || {}), id: input.id, ...immutable, version: input.expectedVersion + 1, updatedAt: timestamp, updatedByAuthUid: actor.authUid, updatedByOperatorId: actor.operatorId };
  if (input.action === 'archive') Object.assign(record, { archivedAt: timestamp, archivedByAuthUid: actor.authUid, archivedByOperatorId: actor.operatorId });
  const aid = auditId(input.requestId);
  const audit = { id: aid, actorAuthUid: actor.authUid, operatorId: actor.operatorId, actorIdentifier: text(actor.email || actor.operatorId, 200), action: input.action, recordId: input.id, occurredAt: timestamp, before: snapshot(existing), after: snapshot(record), requestId: input.requestId, requestHash: requestHashValue };
  const receipt = { id: receiptId(input.requestId), requestId: input.requestId, requestHash: requestHashValue, recordId: input.id, auditId: aid, actorAuthUid: actor.authUid, operatorId: actor.operatorId, occurredAt: timestamp, record: structuredClone(record) };
  return { record, audit, receipt, repeated: false, requestHash: requestHashValue, auditId: aid };
}
function readEnvelope(daily) {
  const active = [], archived = [];
  for (const record of Object.values(plain(daily) ? daily : {})) (record && record.archivedAt ? archived : active).push(record);
  const times = active.concat(archived).map(item => String(item.updatedAt || '')).filter(Boolean).sort();
  return { daily: active, archived, lastUpdatedAt: times.at(-1) || '' };
}

module.exports = Object.freeze({ VALUE_FIELDS, validateCommitInput, assertMarketingWriter, requestHash, receiptId, auditId, planCommit, readEnvelope });
