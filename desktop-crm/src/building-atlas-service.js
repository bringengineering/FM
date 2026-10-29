'use strict';
const { isDeepStrictEqual } = require('node:util');
// Main-process only. This module never calls the generic CRM store saver.
const MAX_MODEL_CHARS = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024 + 64 * 1024;
const error = (message, code = 'ATLAS_INVALID_INPUT') => Object.assign(new Error(message), { code });
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function closed(value, keys) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) throw error('지도 요청 형식이 올바르지 않습니다.');
}
function id(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 150 || /[.#$\[\]/\u0000-\u001f\u007f]/.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) throw error('건물 ID를 확인해 주세요.');
  return value;
}
function etag(value) {
  if (typeof value !== 'string' || !value || value.length > 256 || !/^(?:"[A-Za-z0-9+/_=-]+"|[A-Za-z0-9+/_=-]+)$/.test(value)) throw error('동시 편집 확인값을 확인해 주세요.');
  return value;
}
function boundedTree(value, key = '', depth = 0) {
  if (depth > 20) throw error('지도 데이터 구조가 너무 깊습니다.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw error('유효한 숫자를 입력해 주세요.'); return; }
  if (typeof value === 'string') {
    const limit = key === 'photoData' ? 800000 : key === 'image' ? 1200000 : 20000;
    if (value.length > limit) throw error('지도 항목의 허용 크기를 초과했습니다.', 'ATLAS_TOO_LARGE');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 2000) throw error('지도 항목 수가 너무 많습니다.', 'ATLAS_TOO_LARGE');
    for (const child of value) boundedTree(child, '', depth + 1);
    return;
  }
  if (!plain(value)) throw error('JSON 지도 데이터만 저장할 수 있습니다.');
  for (const [name, child] of Object.entries(value)) {
    if (name.length > 150 || ['__proto__', 'prototype', 'constructor'].includes(name)) throw error('지도 항목 이름을 확인해 주세요.');
    boundedTree(child, name, depth + 1);
  }
}
async function encodeModel(value) {
  closed(value, ['version', 'building', 'records']); boundedTree(value);
  const { validate } = await import('./building-atlas/upstream/model.mjs');
  validate(value);
  const text = JSON.stringify(value);
  if (text.length > MAX_MODEL_CHARS || Buffer.byteLength(text, 'utf8') > 8 * 1024 * 1024) throw error('지도 전체 용량이 허용 크기를 초과했습니다.', 'ATLAS_TOO_LARGE');
  return text;
}
async function decodeRecord(value, buildingId) {
  if (value === null) return null;
  closed(value, ['schemaVersion', 'buildingId', 'revision', 'updatedBy', 'updatedAtMs', 'modelJson']);
  if (value.schemaVersion !== 1 || value.buildingId !== buildingId || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.updatedBy !== 'string' || !value.updatedBy || value.updatedBy.length > 128 || !Number.isSafeInteger(value.updatedAtMs) || value.updatedAtMs <= 0 || typeof value.modelJson !== 'string' || value.modelJson.length > MAX_MODEL_CHARS) throw error('저장된 지도 형식을 확인할 수 없습니다.', 'ATLAS_INVALID_RESPONSE');
  let model;
  try { model = JSON.parse(value.modelJson); } catch { throw error('저장된 지도 내용을 읽을 수 없습니다.', 'ATLAS_INVALID_RESPONSE'); }
  await encodeModel(model);
  return { buildingId, revision: value.revision, updatedBy: value.updatedBy, updatedAtMs: value.updatedAtMs, model };
}
function canWrite(client) {
  const session = client.requireOfficeSession();
  return ['admin', 'member'].includes(session.role) && !(session.role === 'member' && session.marketingRole === 'marketing');
}
async function authorize(client, guard, mutation) {
  if (client.databaseRoot !== 'crmCompany') throw error('회사 지도 저장소를 확인해 주세요.', 'ATLAS_COMPANY_ONLY');
  client.requireOfficeSession(); await client.verifyAccess(); client.assertSessionGuardActive(guard); client.requireOfficeSession();
  if (mutation) client.requireMutationPermission();
}
async function readSnapshot(client, buildingId, guard, helpers) {
  client.assertSessionGuardActive(guard);
  const token = await client.ensureIdToken(false);
  client.assertSessionGuardActive(guard);
  const location = helpers.resolveLocation(`buildingAtlas/${buildingId}`, client.databaseRoot);
  const url = `${client.firebase.databaseUrl}/${location}.json?auth=${encodeURIComponent(token)}`;
  let response;
  try { response = await client.fetch(url, { method: 'GET', headers: { Accept: 'application/json', 'X-Firebase-ETag': 'true' }, signal: AbortSignal.timeout(30000) }); }
  catch { client.assertSessionGuardActive(guard); throw error('지도 서버에 연결할 수 없습니다.', 'NETWORK'); }
  client.assertSessionGuardActive(guard);
  const value = await helpers.readJson(response, MAX_RESPONSE_BYTES, 'ATLAS_READ_FAILED', { rejectEmpty: true });
  client.assertSessionGuardActive(guard);
  const tag = etag(response.headers.get('etag'));
  const record = await decodeRecord(value, buildingId);
  client.assertSessionGuardActive(guard);
  return { record, etag: tag, canWrite: canWrite(client) };
}
async function requireBuilding(client, buildingId, guard) {
  const building = await client.boundedDbGet(`crmShared/data/buildings/${buildingId}`, 1024 * 1024);
  client.assertSessionGuardActive(guard);
  if (!building || building.id !== buildingId || building.archivedAt || building.archived === true || building.deleted === true || building.deletedAt) throw error('연결된 CRM 건물을 확인해 주세요.', 'ATLAS_BUILDING_UNAVAILABLE');
}
async function conditionalPut(client, buildingId, record, tag, guard, helpers) {
  client.assertSessionGuardActive(guard);
  const token = await client.ensureIdToken(false);
  client.assertSessionGuardActive(guard);
  client.requireMutationPermission();
  const location = helpers.resolveLocation(`buildingAtlas/${buildingId}`, client.databaseRoot);
  const url = `${client.firebase.databaseUrl}/${location}.json?auth=${encodeURIComponent(token)}`;
  const response = await client.fetch(url, { method: 'PUT', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'If-Match': tag }, body: JSON.stringify(record), signal: AbortSignal.timeout(30000) });
  client.assertSessionGuardActive(guard);
  if (response.status === 412) { await response.body?.cancel(); throw error('다른 직원이 먼저 수정했습니다.', 'ATLAS_CONFLICT'); }
  const confirmed = await helpers.readJson(response, MAX_RESPONSE_BYTES, 'ATLAS_WRITE_UNCONFIRMED', { rejectEmpty: true });
  client.assertSessionGuardActive(guard);
  if (!isDeepStrictEqual(confirmed, record)) throw error('저장 응답 내용이 일치하지 않습니다.', 'ATLAS_WRITE_UNCONFIRMED');
}
async function load(client, input, helpers) {
  closed(input, ['buildingId']); const buildingId = id(input.buildingId);
  const guard = client.captureSessionGuard(); await authorize(client, guard, false);
  await requireBuilding(client, buildingId, guard);
  return readSnapshot(client, buildingId, guard, helpers);
}
async function save(client, input, helpers) {
  closed(input, ['buildingId', 'model', 'expectedRevision', 'etag']);
  const buildingId = id(input.buildingId), tag = etag(input.etag), revision = input.expectedRevision;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw error('저장 버전을 확인해 주세요.');
  const model = structuredClone(input.model);
  const guard = client.captureSessionGuard(); await authorize(client, guard, true);
  client.requireMutationPermission(model);
  const modelJson = await encodeModel(model); client.assertSessionGuardActive(guard);
  await requireBuilding(client, buildingId, guard);
  const current = await readSnapshot(client, buildingId, guard, helpers);
  if ((current.record?.revision ?? 0) !== revision || current.etag !== tag) throw error('다른 직원이 먼저 수정했습니다. 작성 내용을 보관하고 최신 지도를 확인해 주세요.', 'ATLAS_CONFLICT');
  client.requireMutationPermission(model); client.assertSessionGuardActive(guard);
  const record = { schemaVersion: 1, buildingId, revision: revision + 1, updatedBy: guard.uid, updatedAtMs: Date.now(), modelJson };
  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_RESPONSE_BYTES) throw error('서버에서 다시 읽을 수 있는 지도 용량을 초과했습니다.', 'ATLAS_TOO_LARGE');
  try { await conditionalPut(client, buildingId, record, tag, guard, helpers); }
  catch (cause) {
    client.assertSessionGuardActive(guard);
    if (cause?.code === 'ATLAS_CONFLICT') throw error('다른 직원이 먼저 수정했습니다. 작성 내용은 보관됩니다.', 'ATLAS_CONFLICT');
    throw error('지도 저장을 서버에서 확인하지 못했습니다. 작성 내용을 보관하고 다시 확인해 주세요.', 'ATLAS_WRITE_UNCONFIRMED');
  }
  client.assertSessionGuardActive(guard);
  const confirmed = await readSnapshot(client, buildingId, guard, helpers);
  if (confirmed.record?.revision !== record.revision || confirmed.record?.updatedBy !== record.updatedBy || JSON.stringify(confirmed.record?.model) !== modelJson) throw error('저장 후 지도가 다시 변경되었습니다. 최신 지도를 확인해 주세요.', 'ATLAS_WRITE_UNCONFIRMED');
  return confirmed;
}
module.exports = { load, save, MAX_MODEL_CHARS, MAX_RESPONSE_BYTES };
