import { expect, it, vi } from 'vitest';
import { appsScriptBridge, listOwnerNoticeUnits, ownerNotice, ownerNoticeStatus, sendOwnerNotice, WORKFLOW_ENDPOINT, type OwnerNoticeReads } from '../src/field-mobile/owner-notice.js';
import { handleOwnerNotice } from '../src/field-mobile/owner-notice-http.js';
import type { MobileAuthDependencies } from '../src/field-mobile/access.js';

const REQUEST = '0f4d6a0e-5d0b-4b3f-9a51-8f6d9b1c2a3e';
const sender = { uid: 'admin-a', email: 'admin@example.test', idToken: 'token-a' };
function data() {
  return {
    units: { 'unit-a': { id: 'unit-a', crmBuildingId: 'bld-a', label: '201호' }, 'unit-old': { id: 'unit-old', crmBuildingId: 'bld-a', label: '301', archivedAt: '2026-01-01' },
      'unit-b': { id: 'unit-b', crmBuildingId: 'bld-b', label: '101' } } as Record<string, any>,
    buildings: { 'bld-a': { id: 'bld-a', name: '시험빌라', roadAddress: '강원특별자치도 원주시 시험로 12', ownerCustomerId: 'owner-a' }, 'bld-b': { id: 'bld-b', roadAddress: '강원특별자치도 원주시 시험로 30' } } as Record<string, any>,
    customers: { 'owner-a': { id: 'owner-a', name: '합성 건물주', phone: '010-0000-0000' }, 'tenant-a': { id: 'tenant-a', name: '세입자', phone: '01011112222' } } as Record<string, any>,
    deliveries: { r1: { sourceType: 'buildingUnit', sourceId: 'unit-a', category: 'owner_move_out', status: 'delivered', requestedAt: '2026-11-01T00:00:00Z' } } as Record<string, any>,
  };
}
function reads(d = data()): OwnerNoticeReads {
  return { units: async () => d.units, unit: async id => d.units[id] ?? null, buildings: async () => d.buildings, building: async id => d.buildings[id] ?? null,
    customers: async () => d.customers, deliveries: async () => d.deliveries };
}
const input = { 계약일: '2026-11-12', 입주일: '2026-11-20', 계약조건: '보증금 500 / 월세 45' };
function preview(d = data()) {
  const values = { ...ownerNotice.formatTurnoverValues('owner_lease_contract', input), 건물주소: ownerNotice.buildingAddress(d.buildings['bld-a']), 호실: '201' };
  return ownerNotice.render('owner_lease_contract', values);
}
const body = (extra: Record<string, unknown> = {}) => ({ requestId: REQUEST, unitId: 'unit-a', templateId: 'owner_lease_contract', input, preview: preview(), ...extra });

it('lists only live units whose owner is resolvable, masks the phone, and suggests the next stage', async () => {
  const { units, truncated } = await listOwnerNoticeUnits(reads());
  expect(truncated).toBe(false);
  expect(units).toEqual([expect.objectContaining({ id: 'unit-a', building: '시험빌라', address: '원주시 시험로 12', unit: '201', owner: '합성 건물주', recipient: '010-****-0000', nextStage: 'owner_broker_listed' })]);
  expect(JSON.stringify(units)).not.toContain('01000000000');
});

it('re-resolves the owner on the server and forwards the exact confirmed notice with the sender token', async () => {
  const bridge = vi.fn(async (payload: any) => ({ requestId: payload.requestId, status: 'accepted' }));
  const result = await sendOwnerNotice(body(), sender, reads(), bridge);
  expect(result).toEqual({ requestId: REQUEST, status: 'accepted', recipient: '010-****-0000' });
  expect(bridge).toHaveBeenCalledWith(expect.objectContaining({ action: 'sendCustomerMessage', requestId: REQUEST, customerId: 'owner-a', templateId: 'owner_lease_contract',
    sourceType: 'buildingUnit', sourceId: 'unit-a', uid: 'admin-a', adminEmail: 'admin@example.test', idToken: 'token-a',
    variables: { 계약일: '11월 12일(목)', 입주일: '11월 20일(금)', 계약조건: '보증금 500 / 월세 45' } }));
});

it('refuses client-chosen recipients, unknown fields, changed wording, missing values, and owners without a phone', async () => {
  const bridge = vi.fn();
  await expect(sendOwnerNotice(body({ customerId: 'tenant-a' }), sender, reads(), bridge)).rejects.toThrow('REQUEST_INVALID');
  await expect(sendOwnerNotice(body({ input: { ...input, 전화: '010' } }), sender, reads(), bridge)).rejects.toThrow('REQUEST_INVALID');
  await expect(sendOwnerNotice(body({ templateId: 'owner_subscription_due' }), sender, reads(), bridge)).rejects.toThrow('REQUEST_INVALID');
  await expect(sendOwnerNotice(body({ preview: preview().replace('500', '50') }), sender, reads(), bridge)).rejects.toThrow('NOTICE_CHANGED');
  await expect(sendOwnerNotice(body({ input: { ...input, 계약조건: '' } }), sender, reads(), bridge)).rejects.toThrow('NOTICE_FIELDS_REQUIRED');
  await expect(sendOwnerNotice(body({ unitId: 'unit-b' }), sender, reads(), bridge)).rejects.toThrow('OWNER_NOT_FOUND');
  const d = data(); d.customers['owner-a'].phone = '';
  await expect(sendOwnerNotice(body(), sender, reads(d), bridge)).rejects.toThrow('OWNER_PHONE_REQUIRED');
  expect(bridge).not.toHaveBeenCalled();
});

it('reports a lost response as unknown and reads status only for the same request', async () => {
  await expect(sendOwnerNotice(body(), sender, reads(), vi.fn(async () => { throw Error('lost'); }))).rejects.toThrow('DELIVERY_STATUS_UNKNOWN');
  await expect(sendOwnerNotice(body(), sender, reads(), vi.fn(async () => ({ requestId: 'other', status: 'accepted' })))).rejects.toThrow('DELIVERY_STATUS_UNKNOWN');
  expect(await ownerNoticeStatus(REQUEST, sender, vi.fn(async () => ({ requestId: REQUEST, status: 'delivered' })))).toEqual({ requestId: REQUEST, status: 'delivered' });
});

it('posts to the fixed workflow endpoint and hides server rejection messages', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: false, message: '고객 메시지 정책 차단' }), { status: 200 }));
  await expect(appsScriptBridge(fetcher as never)({ action: 'x' })).rejects.toThrow('DELIVERY_REJECTED');
  expect(fetcher).toHaveBeenCalledWith(WORKFLOW_ENDPOINT, expect.objectContaining({ method: 'POST' }));
  const ok = vi.fn(async () => new Response(JSON.stringify({ requestId: REQUEST, status: 'accepted' }), { status: 200 }));
  expect(await appsScriptBridge(ok as never)({})).toEqual({ requestId: REQUEST, status: 'accepted' });
});

function auth(role: 'admin' | 'member'): MobileAuthDependencies {
  return { projectId: 'bring-fm', allowedNativeAppIds: ['1:1:android:abc'], verifyAppCheck: async () => ({ app_id: '1:1:android:abc' }),
    verifyIdentity: async () => ({ uid: 'admin-a', aud: 'bring-fm', iss: 'https://securetoken.google.com/bring-fm', email: 'admin@example.test', email_verified: true, firebase: { sign_in_provider: 'password' } }),
    readAccess: async () => ({ enabled: true, role, email: 'admin@example.test' }) };
}
const request = (method: string, url: string, payload?: unknown) => ({ method, url, authorization: 'Bearer token-a', appCheck: 'check', contentType: 'application/json', body: payload ? Buffer.from(JSON.stringify(payload)) : Buffer.alloc(0) });

it('routes owner notices for admins only', async () => {
  const bridge = vi.fn(async (payload: any) => ({ requestId: payload.requestId, status: 'accepted' }));
  const deps = (role: 'admin' | 'member') => ({ auth: auth(role), reads: reads(), bridge, allowRequest: () => true });
  expect((await handleOwnerNotice(request('GET', '/v1/field-app/owner-notices/units'), deps('member'))).status).toBe(403);
  expect((await handleOwnerNotice(request('GET', '/v1/field-app/owner-notices/units'), deps('admin'))).status).toBe(200);
  const sent = await handleOwnerNotice(request('POST', '/v1/field-app/owner-notices/send', body()), deps('admin'));
  expect(sent).toEqual({ status: 200, body: { requestId: REQUEST, status: 'accepted', recipient: '010-****-0000' } });
  expect(bridge).toHaveBeenCalledWith(expect.objectContaining({ idToken: 'token-a', adminEmail: 'admin@example.test' }));
  expect((await handleOwnerNotice(request('GET', '/v1/field-app/owner-notices/send'), deps('admin'))).status).toBe(405);
  expect((await handleOwnerNotice(request('GET', '/v1/field-app/owner-notices/units?all=1'), deps('admin'))).status).toBe(400);
});
