import { expect, it, vi } from 'vitest';
import { CompanySession, type EmployeeIdentity } from '../src/auth/session';
import type { CompanySiteContext, SiteWorkspaceApi } from '../src/api/sites';
import { FieldError } from '../src/domain/model';
const context: CompanySiteContext = { schemaVersion: 1, actor: { uid: 'staff-a', role: 'member' }, capabilities: { readCustomerSites: true, capture: false, archiveReport: false, sendCustomerReport: false } };
function setup() {
  let uid: string | null = null, listener = (_uid: string | null) => {};
  const identity: EmployeeIdentity = { ready: async () => {}, currentUid: () => uid,
    signIn: vi.fn(async () => { uid = 'staff-a'; listener(uid); return uid; }), signOut: vi.fn(async () => { uid = null; listener(null); }),
    credentials: async () => ({ uid: uid!, idToken: 'test', appCheckToken: 'test' }), observe: fn => { listener = fn; return () => { listener = () => {}; }; },
  };
  const api: SiteWorkspaceApi = { context: vi.fn(async () => context), sites: vi.fn(async () => ({ sites: [], nextCursor: null })), site: vi.fn() };
  const session = new CompanySession(identity, () => api);
  return { identity, api, session, change(uidValue: string | null) { uid = uidValue; listener(uid); } };
}
it('does not expose company state before server context and sites are both validated', async () => {
  const f = setup(); await f.session.restore(); expect(f.session.snapshot().phase).toBe('signedOut');
  await f.session.login('staff@example.invalid', 'synthetic-password'); expect(f.session.snapshot().phase).toBe('ready');
  expect(f.api.context).toHaveBeenCalledOnce(); expect(f.api.sites).toHaveBeenCalledWith(null, expect.any(AbortSignal)); f.session.dispose();
});
it('ignores delayed data after logout', async () => {
  const f = setup(); await f.session.restore(); let finish!: () => void;
  f.api.sites = () => new Promise(resolve => { finish = () => resolve({ sites: [], nextCursor: null }); });
  const login = f.session.login('staff@example.invalid', 'synthetic-password'); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await f.session.logout(); finish(); await login; expect(f.session.snapshot()).toEqual({ phase: 'signedOut' }); f.session.dispose();
});
it('drops the previous account immediately on an SDK account change', async () => {
  const f = setup(); await f.session.restore(); await f.session.login('staff@example.invalid', 'synthetic-password');
  f.change('staff-b'); expect(f.session.snapshot()).toEqual({ phase: 'signedOut', error: 'AUTH_REQUIRED' }); f.session.dispose();
});
it('signs out after server rejection and never exposes raw provider errors', async () => {
  const f = setup(); f.api.context = async () => { throw Error('PRIVATE_CREDENTIAL'); };
  await f.session.restore(); await f.session.login('staff@example.invalid', 'synthetic-password');
  expect(f.identity.signOut).toHaveBeenCalledOnce(); expect(f.session.snapshot()).toEqual({ phase: 'error', error: 'SERVER_RESPONSE_INVALID' }); f.session.dispose();
});
it('refreshes restored and foreground sessions against current company access', async () => {
  const f = setup(); f.change('staff-a'); await f.session.restore(); expect(f.session.snapshot().phase).toBe('ready');
  f.api.context = async () => { throw new FieldError('AUTH_REQUIRED'); }; await f.session.refresh();
  expect(f.session.snapshot()).toEqual({ phase: 'error', error: 'AUTH_REQUIRED' }); expect(f.identity.currentUid()).toBeNull(); f.session.dispose();
});
it('cannot publish or keep late workspace results after disposal', async () => {
  const f = setup(); await f.session.restore(); let finish!: (value: CompanySiteContext) => void;
  f.api.context = () => new Promise(resolve => { finish = resolve; });
  const login = f.session.login('staff@example.invalid', 'synthetic-password'); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  f.session.dispose(); finish(context); await login; expect(f.session.snapshot()).toEqual({ phase: 'signedOut' }); expect(f.api.sites).not.toHaveBeenCalled();
});
it('finishes a pending native login before sign-out so logout cannot leave an authenticated SDK user', async () => {
  const f = setup(); await f.session.restore(); let finish!: () => void;
  f.identity.signIn = () => new Promise(resolve => { finish = () => { f.change('staff-a'); resolve('staff-a'); }; });
  const login = f.session.login('staff@example.invalid', 'synthetic-password'); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  const logout = f.session.logout(); finish(); await Promise.all([login, logout]);
  expect(f.identity.currentUid()).toBeNull(); expect(f.session.snapshot()).toEqual({ phase: 'signedOut' }); expect(f.api.context).not.toHaveBeenCalled(); f.session.dispose();
});
