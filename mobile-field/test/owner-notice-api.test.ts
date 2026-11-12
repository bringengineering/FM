import { expect, it, vi } from 'vitest';
import { CompanyRecordingApi } from '../src/api/recording';

const REQUEST = '0f4d6a0e-5d0b-4b3f-9a51-8f6d9b1c2a3e';
const unit = { id: 'unit-a', buildingId: 'bld-a', building: '시험빌라', address: '원주시 시험로 12', unit: '201', owner: '합성 건물주', recipient: '010-****-0000', nextStage: 'owner_lease_contract',
  progress: [{ id: 'owner_move_out', count: 1, lastSentAt: '2026-11-01T00:00:00Z' }] };
function api(handler: (url: string, init?: RequestInit) => Response) {
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => handler(String(url), init));
  return { fetcher, api: new CompanyRecordingApi('https://field-test.invalid/v1/field-app', 'admin-a', async () => ({ uid: 'admin-a', idToken: 'test-token', appCheckToken: 'test-check' }), fetcher as typeof fetch) };
}

it('loads owner-notice units and rejects responses that expose a full phone number', async () => {
  const ok = api(() => Response.json({ units: [unit], truncated: false }));
  expect(await ok.api.ownerNoticeUnits(new AbortController().signal)).toEqual({ units: [unit], truncated: false });
  expect(ok.fetcher.mock.calls[0]![0]).toBe('https://field-test.invalid/v1/field-app/owner-notices/units');
  const leaked = api(() => Response.json({ units: [{ ...unit, recipient: '01000000000' }], truncated: false }));
  await expect(leaked.api.ownerNoticeUnits(new AbortController().signal)).rejects.toThrow('SERVER_RESPONSE_INVALID');
});

it('sends the confirmed preview with a stable request id and reads delivery status', async () => {
  const t = api((url, init) => url.endsWith('/send') ? Response.json({ requestId: REQUEST, status: 'accepted', recipient: '010-****-0000' }) : Response.json({ requestId: REQUEST, status: 'delivered' }));
  const body = { requestId: REQUEST, unitId: 'unit-a', templateId: 'owner_lease_contract', input: { 계약일: '2026-11-12' }, preview: '문구' };
  expect(await t.api.sendOwnerNotice(body, new AbortController().signal)).toEqual({ requestId: REQUEST, status: 'accepted', recipient: '010-****-0000' });
  expect(JSON.parse(String(t.fetcher.mock.calls[0]![1]!.body))).toEqual(body);
  expect(await t.api.ownerNoticeStatus(REQUEST, new AbortController().signal)).toEqual({ requestId: REQUEST, status: 'delivered' });
  await expect(t.api.ownerNoticeStatus('not-a-uuid', new AbortController().signal)).rejects.toThrow('REQUEST_INVALID');
});

it('maps safe server rejections to specific messages', async () => {
  const t = api(() => Response.json({ error: { code: 'OWNER_NOT_FOUND' } }, { status: 409 }));
  await expect(t.api.sendOwnerNotice({ requestId: REQUEST, unitId: 'unit-a', templateId: 'owner_move_out', input: {}, preview: 'x' }, new AbortController().signal)).rejects.toThrow('OWNER_NOT_FOUND');
});
