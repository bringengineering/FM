import { describe, expect, it, vi } from 'vitest';
import { handleMobileRead, type MobileReadDependencies } from '../../functions/src/field-mobile/http';
import { CompanyWorkspaceApi } from '../src/api/workspace';
const order = (id = 'job-a', patch = {}) => ({ id, assigneeUid: 'staff-a', buildingId: 'building-a', status: 'assigned', title: '정기 작업', dueDate: '2026-10-26', startDate: '2026-10-25', ...patch });
function setup(role: 'member' | 'admin' = 'member') {
  const deps: MobileReadDependencies = {
    auth: { projectId: 'test', allowedNativeAppIds: ['native-test'],
      verifyIdentity: vi.fn(async token => { if (token !== 'test-token') throw Error('denied'); return { uid: 'staff-a', aud: 'test', iss: 'https://securetoken.google.com/test', email_verified: true, email: 'synthetic@example.invalid', firebase: { sign_in_provider: 'password' } }; }),
      verifyAppCheck: vi.fn(async token => { if (token !== 'test-check') throw Error('denied'); return { app_id: 'native-test' }; }),
      readAccess: vi.fn(async () => ({ enabled: true, email: 'synthetic@example.invalid', role })),
    },
    reads: { listOrders: vi.fn(async () => [{ key: 'job-a', value: order() }]), readOrder: vi.fn(async () => order()),
      readBuilding: vi.fn(async () => ({ id: 'building-a', name: '합성 현장', roadAddress: '합성 주소', ownerPhone: 'PRIVATE', entryCode: 'PRIVATE' })) },
    allowRequest: vi.fn(() => true),
  };
  const request = (url = '/v1/field-app/jobs', patch = {}) => handleMobileRead({ method: 'GET', url, authorization: 'Bearer test-token', appCheck: 'test-check', bodyBytes: 0, ...patch }, deps);
  const api = new CompanyWorkspaceApi('https://test.invalid/v1/field-app', 'staff-a', async () => ({ uid: 'staff-a', idToken: 'test-token', appCheckToken: 'test-check' }), async (input, init) => {
    const url = new URL(String(input)), headers = new Headers(init?.headers);
    const response = await request(url.pathname + url.search, { method: init?.method, authorization: headers.get('authorization'), appCheck: headers.get('x-firebase-appcheck') });
    return Response.json(response.body, { status: response.status });
  });
  return { deps, request, api };
}
describe('employee CRM workspace contract', () => {
  it('matches client context/list/detail while projecting only required building fields', async () => {
    const { api } = setup(), signal = new AbortController().signal;
    expect((await api.context(signal)).capabilities).toEqual({ readJobs: true, capture: false, archiveReport: false, sendCustomerReport: false });
    const page = await api.jobs(null, signal); expect(page.jobs).toHaveLength(1);
    expect(await api.job('job-a', signal)).toEqual(page.jobs[0]);
    expect(JSON.stringify(page)).not.toContain('PRIVATE'); expect(JSON.stringify(page)).not.toContain('assigneeUid');
  });
  it('filters another employee before reading the building, even if the adapter returns it', async () => {
    const { deps, request } = setup(); deps.reads.listOrders = async () => [{ key: 'job-b', value: order('job-b', { assigneeUid: 'staff-b' }) }];
    expect((await request()).body).toEqual({ jobs: [], nextCursor: null }); expect(deps.reads.readBuilding).not.toHaveBeenCalled();
  });
  it('rechecks reassignment on detail and returns no building data', async () => {
    const { deps, request } = setup(); deps.reads.readOrder = async () => order('job-a', { assigneeUid: 'staff-b' });
    expect((await request('/v1/field-app/jobs/job-a')).status).toBe(404); expect(deps.reads.readBuilding).not.toHaveBeenCalled();
  });
  it('allows an active administrator to inspect another assigned job', async () => {
    const { deps, request } = setup('admin'); deps.reads.readOrder = async () => order('job-a', { assigneeUid: 'staff-b' });
    expect((await request('/v1/field-app/jobs/job-a')).status).toBe(200);
  });
  it('advances the page past 50 excluded records without exposing them', async () => {
    const { deps, request } = setup(); deps.reads.listOrders = vi.fn(async () => Array.from({ length: 51 }, (_, i) => ({ key: 'job-' + i, value: order('job-' + i, { status: 'done' }) })));
    expect((await request('/v1/field-app/jobs?cursor=earlier')).body).toEqual({ jobs: [], nextCursor: 'job-49' });
    expect(deps.reads.listOrders).toHaveBeenCalledWith({ uid: 'staff-a', role: 'member' }, 'earlier', 51);
  });
  it.each([{ deleted: true }, { archivedAt: 'now' }, { id: 'wrong-id' }])('excludes invalid/removed buildings %j', async patch => {
    const { deps, request } = setup(); deps.reads.readBuilding = async () => ({ id: 'building-a', name: '합성 현장', address: '합성 주소', ...patch });
    expect((await request()).body).toEqual({ jobs: [], nextCursor: null });
  });
  it.each(['?uid=staff-b', '?cursor=a&cursor=b', '?cursor=..%2Fsecret'])('rejects query manipulation %s', async suffix => {
    expect((await setup().request('/v1/field-app/jobs' + suffix)).status).toBe(400);
  });
  it('rejects mutation methods and body bytes before any company read', async () => {
    const { deps, request } = setup(); expect((await request(undefined, { method: 'POST' })).status).toBe(405);
    expect((await request(undefined, { bodyBytes: 1 })).status).toBe(400); expect(deps.auth.readAccess).not.toHaveBeenCalled();
  });
  it('requires App Check and current non-deleted CRM access on every query', async () => {
    const { deps, request } = setup(); expect((await request(undefined, { appCheck: '' })).status).toBe(401);
    deps.auth.readAccess = async () => ({ enabled: true, role: 'member', email: 'synthetic@example.invalid', deletedAt: 123 });
    expect((await request()).status).toBe(403); expect(deps.reads.listOrders).not.toHaveBeenCalled();
  });
  it('fails closed on missing native enrollment, rate limit and source failures without reflecting details', async () => {
    const { deps, request } = setup(); deps.auth.allowedNativeAppIds = []; expect((await request()).status).toBe(503);
    deps.auth.allowedNativeAppIds = ['native-test']; deps.allowRequest = () => false; expect((await request()).status).toBe(429);
    deps.allowRequest = () => true; deps.reads.listOrders = async () => { throw Error('PRIVATE_URL'); };
    const result = await request(); expect(result.status).toBe(503); expect(JSON.stringify(result)).not.toContain('PRIVATE_URL');
  });
});
