import { createRequire } from 'node:module';

/** 건물주 안내(퇴실 → 입주 5단계) 알림톡을 현장앱에서 보낸다.
 * 문구·변수 규칙은 CRM과 같은 owner-notice-core.js 하나만 쓴다. 실제 발송은 CRM이
 * 쓰는 업무 자동화 서버(Apps Script)가 사용자 토큰으로 건물주·호실·템플릿을 다시
 * 확인한 뒤 보낸다. 이 서버는 앱이 보낸 고객 ID를 믿지 않고 호실 → 건물 → 건물주를
 * 직접 다시 찾는다.
 */
export interface OwnerNoticeCore {
  TEMPLATES: Record<string, { id: string; label: string; delivery: string; stage?: number; repeatable?: boolean; variables: string[] }>;
  TURNOVER_FIELDS: Record<string, { key: string; label: string; type: string; placeholder?: string }[]>;
  TURNOVER_STAGES: { id: string; label: string; stage: number }[];
  buildingAddress(building: unknown): string;
  unitLabel(unit: unknown): string;
  formatTurnoverValues(templateId: string, input: unknown): Record<string, string>;
  render(templateId: string, values: Record<string, string>): string;
  missingVariables(templateId: string, values: Record<string, string>): string[];
  ownerForBuilding(building: unknown, customers: unknown[]): Record<string, any> | null;
  turnoverProgress(deliveries: unknown[], unitId: string): { id: string; label: string; stage: number; count: number; lastSentAt: string }[];
  nextTurnoverStage(progress: unknown[]): string;
}
// The deployment bundle copies this exact desktop module; no second catalog.
export const ownerNotice = createRequire(import.meta.url)('../../../desktop-crm/src/owner-notice-core.js') as OwnerNoticeCore;

type Row = Record<string, any>;
export interface OwnerNoticeReads {
  units(): Promise<Record<string, unknown> | null>;
  unit(id: string): Promise<unknown>;
  buildings(): Promise<Record<string, unknown> | null>;
  building(id: string): Promise<unknown>;
  customers(): Promise<Record<string, unknown> | null>;
  deliveries(): Promise<Record<string, unknown> | null>;
}
export interface OwnerNoticeSender { uid: string; email: string; idToken: string }
export interface WorkflowBridge { (payload: Row): Promise<Row> }
export class OwnerNoticeError extends Error {
  constructor(readonly code: 'REQUEST_INVALID' | 'UNIT_NOT_FOUND' | 'OWNER_NOT_FOUND' | 'OWNER_PHONE_REQUIRED' | 'NOTICE_FIELDS_REQUIRED' | 'NOTICE_CHANGED'
    | 'DELIVERY_NOT_FOUND' | 'DELIVERY_STATUS_UNKNOWN' | 'DELIVERY_REJECTED' | 'SERVICE_UNAVAILABLE', readonly status = 400) { super(code); }
}
export const MAX_UNITS = 250;
const object = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
const live = (v: unknown): v is Row => object(v) && !v.archivedAt && !v.deletedAt && v.deleted !== true && v.archived !== true;
const rows = (value: unknown) => object(value) ? Object.entries(value).filter(([key, row]) => id(key) && live(row)).map(([key, row]) => ({ ...(row as Row), id: (row as Row).id || key })) : [];
const line = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const phone = (v: unknown) => String(v || '').replace(/\D/g, '');
const mask = (v: string) => `${v.slice(0, 3)}-****-${v.slice(-4)}`;
const isTurnover = (templateId: unknown): templateId is string => typeof templateId === 'string' && !!ownerNotice.TURNOVER_FIELDS[templateId];
const unitBuildingId = (unit: Row) => String(unit.crmBuildingId || unit.buildingId || '');

export interface OwnerNoticeUnit {
  id: string; buildingId: string; address: string; unit: string; owner: string; recipient: string;
  nextStage: string; progress: { id: string; count: number; lastSentAt: string }[];
}
function project(unit: Row, building: Row | undefined, customers: Row[], deliveries: Row[]): OwnerNoticeUnit | null {
  if (!building || !live(building) || !id(unit.id)) return null;
  const owner = ownerNotice.ownerForBuilding({ ...building, id: building.id }, customers);
  const to = phone(owner?.phone);
  if (!owner || !id(owner.id) || !/^01\d{8,9}$/.test(to)) return null;
  const label = ownerNotice.unitLabel(unit), address = ownerNotice.buildingAddress(building);
  if (!label || !address) return null;
  const progress = ownerNotice.turnoverProgress(deliveries, unit.id);
  return { id: unit.id, buildingId: String(building.id), address, unit: label, owner: line(owner.nickname || owner.name || owner.company || '건물주', 60), recipient: mask(to),
    nextStage: ownerNotice.nextTurnoverStage(progress), progress: progress.map(item => ({ id: item.id, count: item.count, lastSentAt: line(item.lastSentAt, 40) })) };
}
/** 건물주를 정확히 한 명 찾을 수 있고 휴대전화가 있는 호실만 보인다. */
export async function listOwnerNoticeUnits(reads: OwnerNoticeReads): Promise<{ units: OwnerNoticeUnit[]; truncated: boolean }> {
  const [units, buildings, customers, deliveries] = await Promise.all([reads.units(), reads.buildings(), reads.customers(), reads.deliveries()]);
  const byId = new Map(rows(buildings).map(row => [String(row.id), row]));
  const people = rows(customers), sent = object(deliveries) ? Object.values(deliveries).filter(object) : [];
  const list = rows(units).map(unit => project(unit, byId.get(unitBuildingId(unit)), people, sent)).filter((row): row is OwnerNoticeUnit => !!row)
    .sort((a, b) => a.address.localeCompare(b.address, 'ko') || a.unit.localeCompare(b.unit, 'ko', { numeric: true }));
  return { units: list.slice(0, MAX_UNITS), truncated: list.length > MAX_UNITS };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseSend(input: unknown) {
  if (!object(input) || Object.keys(input).some(key => !['requestId', 'unitId', 'templateId', 'input', 'preview'].includes(key))
    || typeof input.requestId !== 'string' || !UUID.test(input.requestId) || !id(input.unitId) || !isTurnover(input.templateId)
    || !object(input.input) || typeof input.preview !== 'string' || input.preview.length > 2000) throw new OwnerNoticeError('REQUEST_INVALID');
  const fields = ownerNotice.TURNOVER_FIELDS[input.templateId]!;
  const raw = input.input as Row;
  if (Object.keys(raw).some(key => !fields.some(field => field.key === key)) || Object.values(raw).some(value => typeof value !== 'string' || value.length > 80)) throw new OwnerNoticeError('REQUEST_INVALID');
  return { requestId: input.requestId.toLowerCase(), unitId: input.unitId, templateId: input.templateId, input: raw as Record<string, string>, preview: input.preview };
}
/** 앱이 확인 창에 보여 준 문구(preview)와 서버가 다시 만든 문구가 같을 때만 보낸다. */
export async function sendOwnerNotice(body: unknown, sender: OwnerNoticeSender, reads: OwnerNoticeReads, bridge: WorkflowBridge) {
  const request = parseSend(body);
  const unit = await reads.unit(request.unitId);
  if (!live(unit)) throw new OwnerNoticeError('UNIT_NOT_FOUND', 404);
  const buildingId = unitBuildingId(unit);
  const building = id(buildingId) ? await reads.building(buildingId) : null;
  if (!live(building)) throw new OwnerNoticeError('UNIT_NOT_FOUND', 404);
  const owner = ownerNotice.ownerForBuilding({ ...building, id: building.id || buildingId }, rows(await reads.customers()));
  if (!owner || !id(owner.id)) throw new OwnerNoticeError('OWNER_NOT_FOUND', 409);
  if (!/^01\d{8,9}$/.test(phone(owner.phone))) throw new OwnerNoticeError('OWNER_PHONE_REQUIRED', 409);
  const variables = ownerNotice.formatTurnoverValues(request.templateId, request.input);
  const values = { ...variables, 건물주소: ownerNotice.buildingAddress(building), 호실: ownerNotice.unitLabel({ ...unit, id: request.unitId }) };
  if (ownerNotice.missingVariables(request.templateId, values).length) throw new OwnerNoticeError('NOTICE_FIELDS_REQUIRED', 422);
  if (ownerNotice.render(request.templateId, values) !== request.preview) throw new OwnerNoticeError('NOTICE_CHANGED', 409);
  let result: Row;
  try {
    result = await bridge({ action: 'sendCustomerMessage', requestId: request.requestId, customerId: owner.id, templateId: request.templateId, channel: 'kakao',
      sourceType: 'buildingUnit', sourceId: request.unitId, variables, uid: sender.uid, idToken: sender.idToken, adminEmail: sender.email, adminUid: sender.uid });
  } catch (error) {
    throw error instanceof OwnerNoticeError ? error : new OwnerNoticeError('DELIVERY_STATUS_UNKNOWN', 503);
  }
  if (String(result.requestId || '').toLowerCase() !== request.requestId) throw new OwnerNoticeError('DELIVERY_STATUS_UNKNOWN', 503);
  return { requestId: request.requestId, status: result.status === 'accepted' ? 'accepted' : 'unknown', recipient: mask(phone(owner.phone)) };
}
export async function ownerNoticeStatus(requestId: string, sender: OwnerNoticeSender, bridge: WorkflowBridge) {
  if (!UUID.test(requestId)) throw new OwnerNoticeError('REQUEST_INVALID');
  let result: Row;
  try {
    result = await bridge({ action: 'getCustomerMessageDeliveryStatus', requestId: requestId.toLowerCase(), uid: sender.uid, idToken: sender.idToken, adminEmail: sender.email, adminUid: sender.uid });
  } catch (error) {
    throw error instanceof OwnerNoticeError ? error : new OwnerNoticeError('DELIVERY_STATUS_UNKNOWN', 503);
  }
  if (String(result.requestId || '').toLowerCase() !== requestId.toLowerCase()) throw new OwnerNoticeError('DELIVERY_STATUS_UNKNOWN', 503);
  const status = ['delivered', 'failed', 'accepted'].includes(String(result.status)) ? String(result.status) : 'unknown';
  return { requestId: requestId.toLowerCase(), status };
}

// CRM(remote.js)과 같은 업무 자동화 주소. 사용자 ID 토큰이 실리므로 설정값으로
// 바꿀 수 없게 코드에 고정한다.
export const WORKFLOW_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxGAdtEDoNifxkM-e_Jm7dBkCnjM4oPJqz8RxZXoMoSKod5M_m9Yj2b11-nI97zmfd6Jw/exec';
export function appsScriptBridge(fetcher: typeof fetch = fetch): WorkflowBridge {
  return async payload => {
    let response: Response;
    try {
      response = await fetcher(WORKFLOW_ENDPOINT, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000) });
    } catch { throw new OwnerNoticeError('DELIVERY_STATUS_UNKNOWN', 503); }
    const text = await response.text().catch(() => '');
    if (text.length > 64 * 1024) throw new OwnerNoticeError('DELIVERY_STATUS_UNKNOWN', 503);
    let result: unknown = null;
    try { result = text ? JSON.parse(text) : null; } catch { result = null; }
    if (!response.ok || !object(result)) throw new OwnerNoticeError('DELIVERY_STATUS_UNKNOWN', 503);
    // 실패는 ok:false 와 메시지로 온다. 성공은 발송 기록(messageDeliveries) 그대로 오고
    // ok 필드가 없을 수 있다. 메시지는 앱에 넘기지 않는다.
    if (result.ok === false) {
      console.warn(JSON.stringify({ event: 'field_owner_notice_rejected', message: line(result.message, 160) }));
      throw new OwnerNoticeError('DELIVERY_REJECTED', 409);
    }
    return result;
  };
}
