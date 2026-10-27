import { expect, it, vi } from 'vitest';
import { handleMobileRead, type MobileReadDependencies } from '../../functions/src/field-mobile/http';
import { CompanySiteApi } from '../src/api/sites';
const customer = (id = 'customer-a', extra = {}) => ({ id, name: '합성 고객', address: '합성 주소', ...extra });
function setup() {
  const deps: MobileReadDependencies = {
    auth: { projectId: 'test', allowedNativeAppIds: ['native-test'],
      verifyIdentity: vi.fn(async () => ({ uid: 'staff-a', aud: 'test', iss: 'https://securetoken.google.com/test', email_verified: true, email: 'test@example.invalid', firebase: { sign_in_provider: 'password' } })),
      verifyAppCheck: vi.fn(async () => ({ app_id: 'native-test' })),
      readAccess: vi.fn(async () => ({ enabled: true, email: 'test@example.invalid', role: 'member' })),
    },
    reads: { listOrders: vi.fn(), readOrder: vi.fn(), readBuilding: vi.fn() },
    sites: { listCustomers: vi.fn(async () => [{ key: 'customer-a', value: customer() }]), readCustomer: vi.fn(async () => customer()) },
    allowRequest: vi.fn(() => true),
  };
  const request = (url = '/v1/field-app/sites', extra = {}) => handleMobileRead({ method: 'GET', url, authorization: 'Bearer synthetic-id', appCheck: 'synthetic-check', bodyBytes: 0, ...extra }, deps);
  const api = new CompanySiteApi('https://test.invalid/v1/field-app', 'staff-a', async () => ({ uid: 'staff-a', idToken: 'synthetic-id', appCheckToken: 'synthetic-check' }), async (input, init) => {
    const url = new URL(String(input)); const result = await request(url.pathname + url.search, { method: init?.method });
    return Response.json(result.body, { status: result.status });
  });
  return { deps, request, api };
}
it('lists and opens a CRM customer address with no building or work order, for an active office member', async () => {
  const { deps, api } = setup(), signal = new AbortController().signal;
  expect((await api.context(signal)).capabilities.readCustomerSites).toBe(true);
  const page = await api.sites(null, signal);
  expect(page).toEqual({ sites: [{ id: 'customer-a', customerId: 'customer-a', name: '합성 고객', address: '합성 주소' }], nextCursor: null });
  expect(await api.site('customer-a', signal)).toEqual(page.sites[0]);
  expect(deps.reads.listOrders).not.toHaveBeenCalled(); expect(deps.reads.readBuilding).not.toHaveBeenCalled();
});
it('projects only customer identity, internal display name and address; no contacts or legacy links', async () => {
  const { deps, api } = setup();
  deps.sites!.readCustomer = async () => customer('customer-a', { nickname: '내부 별명', roadAddress: '최신 도로명주소', phone: 'PRIVATE', email: 'PRIVATE', notes: 'PRIVATE', buildingIds: ['PRIVATE'], buildingIdLinks: { PRIVATE: true } });
  expect(await api.site('customer-a', new AbortController().signal)).toEqual({ id: 'customer-a', customerId: 'customer-a', name: '내부 별명', address: '최신 도로명주소' });
});
it('keeps customers without an address visible and never substitutes a linked-building address', async () => {
  const { deps, api } = setup(); deps.sites!.readCustomer = async () => customer('customer-a', { address: '', buildingIdLinks: { oldBuilding: true } });
  expect((await api.site('customer-a', new AbortController().signal)).address).toBe(''); expect(deps.reads.readBuilding).not.toHaveBeenCalled();
});
it('uses road address, plain address, then jibun address and rereads changes on detail', async () => {
  const { deps, api } = setup(); const signal = new AbortController().signal;
  await api.sites(null, signal); deps.sites!.readCustomer = async () => customer('customer-a', { address: '', jibunAddress: '수정 지번주소' });
  expect((await api.site('customer-a', signal)).address).toBe('수정 지번주소');
});
it.each([{ archivedAt: 'now' }, { deleted: true }, { id: 'wrong-customer' }])('excludes archived/deleted/mismatched records from list and detail: %j', async patch => {
  const { deps, request } = setup(); deps.sites!.listCustomers = async () => [{ key: 'customer-a', value: customer('customer-a', patch) }]; deps.sites!.readCustomer = async () => customer('customer-a', patch);
  expect((await request()).body).toEqual({ sites: [], nextCursor: null }); expect((await request('/v1/field-app/sites/customer-a')).status).toBe(404);
});
it.each(['disabled', 'marketing', 'viewer', 'revoked'])('refuses %s access before reading customer data', async reason => {
  const { deps, request } = setup();
  if (reason === 'revoked') deps.auth.verifyIdentity = async () => { throw Error('revoked'); };
  else deps.auth.readAccess = async () => ({ enabled: reason !== 'disabled', email: 'test@example.invalid', role: reason === 'viewer' ? 'viewer' : 'member', marketingRole: reason === 'marketing' ? 'marketing' : '' });
  expect((await request()).status).toBe(reason === 'revoked' ? 401 : 403);
  expect(deps.sites!.listCustomers).not.toHaveBeenCalled(); expect(deps.sites!.readCustomer).not.toHaveBeenCalled();
});
it('refuses missing attestation and checks current account again on detail', async () => {
  const { deps, request, api } = setup();
  expect((await request(undefined, { appCheck: '' })).status).toBe(401); expect(deps.sites!.listCustomers).not.toHaveBeenCalled();
  await api.sites(null, new AbortController().signal); deps.auth.readAccess = async () => ({ enabled: false });
  expect((await request('/v1/field-app/sites/customer-a')).status).toBe(403); expect(deps.sites!.readCustomer).not.toHaveBeenCalled();
});
it('pages past excluded customers and keeps distinct customers at the same address separate', async () => {
  const { deps, api } = setup(); deps.sites!.listCustomers = vi.fn(async () => Array.from({ length: 51 }, (_, i) => ({ key: `customer-${i}`, value: customer(`customer-${i}`, i < 48 ? { archived: true } : {}) })));
  const page = await api.sites('earlier', new AbortController().signal);
  expect(page.sites.map(s => s.id)).toEqual(['customer-48', 'customer-49']); expect(page.nextCursor).toBe('customer-49');
  expect(deps.sites!.listCustomers).toHaveBeenCalledWith('earlier', 51);
});
it('rejects malformed cursors, body writes and arbitrary user filters', async () => {
  const { request } = setup();
  expect((await request('/v1/field-app/sites?cursor=__proto__')).status).toBe(400);
  expect((await request('/v1/field-app/sites?uid=other')).status).toBe(400);
  expect((await request(undefined, { method: 'POST' })).status).toBe(405);
});
it('the mobile client rejects another customer detail and drops unexpected response fields', async () => {
  const fetcher = vi.fn(async () => Response.json({ site: { id: 'customer-b', customerId: 'customer-b', name: '합성', address: '', phone: 'PRIVATE' } }));
  const api = new CompanySiteApi('https://test.invalid/v1/field-app', 'staff-a', async () => ({ uid: 'staff-a', idToken: 'synthetic', appCheckToken: 'synthetic' }), fetcher);
  await expect(api.site('customer-a', new AbortController().signal)).rejects.toThrow('SERVER_RESPONSE_INVALID');
  const selected = await api.site('customer-b', new AbortController().signal);
  expect(selected).toEqual({ id: 'customer-b', customerId: 'customer-b', name: '합성', address: '' });
});
