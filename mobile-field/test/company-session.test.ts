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
it('searches customer names and addresses across pages without changing the selected page',async()=>{
  const f=setup();await f.session.restore();await f.session.login('staff@example.invalid','synthetic-password');
  f.api.sites=vi.fn(async cursor=>cursor===null?{sites:[{id:'a',customerId:'a',name:'가상 고객',address:'서울 테스트로 1'}],nextCursor:'a'}:{sites:[{id:'b',customerId:'b',name:'다른 고객',address:'부산 해운대로 2'}],nextCursor:null});
  const before=f.session.snapshot(),result=await f.session.searchSites('해운대');
  expect(result.sites.map(s=>s.id)).toEqual(['b']);expect(result.incomplete).toBe(false);expect(f.session.snapshot()).toEqual(before);f.session.dispose();
});
it('never returns a delayed search after the employee signs out',async()=>{
  const f=setup();await f.session.restore();await f.session.login('staff@example.invalid','synthetic-password');let finish!:(page:any)=>void;
  f.api.sites=()=>new Promise(resolve=>{finish=resolve;});const search=f.session.searchSites('주소');await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
  await f.session.logout();finish({sites:[{id:'a',customerId:'a',name:'고객',address:'주소'}],nextCursor:null});await expect(search).rejects.toThrow('AUTH_REQUIRED');f.session.dispose();
});
it('locks the session if customer search detects revoked access',async()=>{
  const f=setup();await f.session.restore();await f.session.login('staff@example.invalid','synthetic-password');
  f.api.sites=async()=>{throw new FieldError('AUTH_REQUIRED');};await expect(f.session.searchSites('고객')).rejects.toThrow('AUTH_REQUIRED');expect(f.session.snapshot()).toEqual({phase:'error',error:'AUTH_REQUIRED'});f.session.dispose();
});
it('reports when a bounded search cannot examine the complete customer list',async()=>{
  const f=setup();await f.session.restore();await f.session.login('staff@example.invalid','synthetic-password');let n=0;
  f.api.sites=async()=>({sites:[{id:`s${++n}`,customerId:`s${n}`,name:'일치 고객',address:'가상 주소'}],nextCursor:`s${n}`});
  const result=await f.session.searchSites('일치');expect(result.sites).toHaveLength(5);expect(result.incomplete).toBe(true);expect(result.nextCursor).toBe('s5');f.session.dispose();
});
it('continues searching beyond the first batch without skipping customers',async()=>{
  const f=setup();await f.session.restore();await f.session.login('staff@example.invalid','synthetic-password');
  f.api.sites=async cursor=>{const page=cursor?Number(cursor.slice(1))+1:1,id=`s${page}`;return{sites:[{id,customerId:id,name:page===7?'찾는 고객':'다른 고객',address:'가상 주소'}],nextCursor:page<7?id:null};};
  const first=await f.session.searchSites('찾는');expect(first.sites).toEqual([]);expect(first.nextCursor).toBe('s5');
  const next=await f.session.searchSites('찾는',first.nextCursor);expect(next.sites.map(s=>s.id)).toEqual(['s7']);expect(next.incomplete).toBe(false);f.session.dispose();
});
it('foreground revalidation preserves the customer workspace and does not reload the list',async()=>{
  const f=setup();await f.session.restore();await f.session.login('staff@example.invalid','synthetic-password');
  const previous=f.session.snapshot();await f.session.revalidate();expect(f.session.snapshot()).toEqual(previous);expect(f.api.sites).toHaveBeenCalledOnce();expect(f.api.context).toHaveBeenCalledTimes(2);f.session.dispose();
});
it('keeps an open local draft during temporary network loss but locks revoked identity',async()=>{
  const f=setup();await f.session.restore();await f.session.login('staff@example.invalid','synthetic-password');
  f.api.context=async()=>{throw new FieldError('NETWORK_UNCERTAIN');};await f.session.revalidate();expect(f.session.snapshot().phase).toBe('ready');
  f.api.context=async()=>{throw new FieldError('AUTH_REQUIRED');};await f.session.revalidate();expect(f.session.snapshot().phase).toBe('error');f.session.dispose();
});
it('keeps the customer list and login when a refresh or selection temporarily loses connection',async()=>{
  const f=setup();await f.session.restore();await f.session.login('staff@example.invalid','synthetic-password');
  const previous=f.session.snapshot();f.api.sites=async()=>{throw new FieldError('NETWORK_UNCERTAIN');};
  expect(await f.session.refresh()).toBe(false);expect(f.session.snapshot()).toEqual({...previous,error:'NETWORK_UNCERTAIN'});expect(f.identity.signOut).not.toHaveBeenCalled();
  f.api.site=async()=>{throw new FieldError('SERVER_UNAVAILABLE');};await f.session.select('customer-a');expect(f.session.snapshot().phase).toBe('ready');expect(f.session.snapshot().error).toBe('SERVER_UNAVAILABLE');expect(f.identity.signOut).not.toHaveBeenCalled();f.session.dispose();
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
