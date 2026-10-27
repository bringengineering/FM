import type { Credentials } from '../api/client';
import type { CompanySiteContext, CustomerSite, CustomerSitePage, SiteWorkspaceApi } from '../api/sites';
import { FieldError } from '../domain/model';

export interface EmployeeIdentity {
  ready(): Promise<void>; currentUid(): string | null;
  signIn(email: string, password: string): Promise<string>; signOut(): Promise<void>;
  credentials(uid: string): Promise<Credentials>;
  observe(listener: (uid: string | null) => void): () => void;
}
export interface CompanyState { phase: 'signedOut' | 'loading' | 'ready' | 'error'; context?: CompanySiteContext; page?: CustomerSitePage; selected?: CustomerSite; error?: string }
const safeCodes = new Set(['AUTH_REQUIRED', 'LOGIN_FAILED', 'EMAIL_VERIFICATION_REQUIRED', 'LOGIN_ACCOUNT_DISABLED', 'LOGIN_PROVIDER_DISABLED', 'LOGIN_APP_NOT_AUTHORIZED', 'LOGIN_PROVIDER_ERROR', 'APP_ATTESTATION_FAILED', 'NATIVE_APP_NOT_CONFIGURED', 'SERVER_UNAVAILABLE', 'NETWORK_UNCERTAIN', 'RATE_LIMITED', 'RESOURCE_NOT_FOUND', 'SERVER_RESPONSE_INVALID']);
export class CompanySession {
  private state: CompanyState = { phase: 'signedOut' };
  private listeners = new Set<(state: CompanyState) => void>();
  private generation = 0; private controller = new AbortController(); private uid: string | null = null;
  private identityChain: Promise<unknown> = Promise.resolve();
  private stopObserving?: () => void; private disposed = false;
  constructor(private identity: EmployeeIdentity, private apiFor: (uid: string) => SiteWorkspaceApi) {}
  snapshot = (): CompanyState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: CompanyState) { if (!this.disposed) { this.state = state; for (const listener of this.listeners) listener(state); } }
  private begin(): number { this.controller.abort(); this.controller = new AbortController(); return ++this.generation; }
  private current(generation: number): boolean { return !this.disposed && generation === this.generation; }
  private identityTask<T>(task: () => Promise<T>): Promise<T> { const result = this.identityChain.then(task); this.identityChain = result.catch(() => undefined); return result; }
  async restore(): Promise<void> {
    const generation = this.begin(); this.publish({ phase: 'loading' });
    try {
      await this.identity.ready(); if (!this.current(generation)) return;
      this.stopObserving?.(); this.stopObserving = this.identity.observe(uid => {
        if (this.uid && uid !== this.uid) { this.begin(); this.uid = null; this.publish({ phase: 'signedOut', error: 'AUTH_REQUIRED' }); }
      });
      const uid = this.identity.currentUid();
      if (!uid) { this.publish({ phase: 'signedOut' }); return; }
      this.uid = uid; await this.load(generation, null);
    } catch (error) { await this.fail(error, generation); }
  }
  async login(email: string, password: string): Promise<void> {
    if (this.state.phase === 'loading' || this.disposed) return;
    const generation = this.begin(); this.publish({ phase: 'loading' });
    try {
      if (!email.trim() || email.length > 254 || !password || password.length > 1024) throw new FieldError('LOGIN_FAILED');
      const uid = await this.identityTask(() => { if (!this.current(generation)) throw new FieldError('AUTH_REQUIRED'); return this.identity.signIn(email.trim(), password); });
      if (!this.current(generation)) return;
      this.uid = uid; await this.load(generation, null);
    } catch (error) { await this.fail(error, generation); }
  }
  private async load(generation: number, cursor: string | null) {
    if (!this.uid) throw new FieldError('AUTH_REQUIRED');
    const uid = this.uid, api = this.apiFor(uid), signal = this.controller.signal;
    const context = await api.context(signal); if (!this.current(generation)) return;
    const page = await api.sites(cursor, signal); if (!this.current(generation)) return;
    if (context.actor.uid !== uid || this.identity.currentUid() !== uid) throw new FieldError('AUTH_REQUIRED');
    this.publish({ phase: 'ready', context, page });
  }
  async refresh(cursor: string | null = null): Promise<void> {
    if (!this.uid || this.state.phase === 'loading' || this.disposed) return;
    const generation = this.begin(); this.publish({ phase: 'loading' });
    try { await this.load(generation, cursor); } catch (error) { await this.fail(error, generation); }
  }
  async select(jobId: string): Promise<void> {
    if (!this.uid || this.state.phase !== 'ready' || this.disposed) return;
    const previous = this.state, uid = this.uid, generation = this.begin(); this.publish({ phase: 'loading' });
    try {
      const api = this.apiFor(uid), context = await api.context(this.controller.signal);
      if (!this.current(generation)) return;
      const selected = await api.site(jobId, this.controller.signal);
      if (this.current(generation)) {
        if (context.actor.uid !== uid || this.identity.currentUid() !== uid) throw new FieldError('AUTH_REQUIRED');
        this.publish({ ...previous, phase: 'ready', context, selected });
      }
    } catch (error) { await this.fail(error, generation); }
  }
  private async fail(error: unknown, generation: number) {
    if (!this.current(generation)) return;
    const code = error instanceof FieldError && safeCodes.has(error.code) ? error.code : this.uid ? 'SERVER_RESPONSE_INVALID' : 'LOGIN_PROVIDER_ERROR';
    this.uid = null; this.begin(); const failureGeneration = this.generation;
    // Keep login disabled until sign-out settles, so it cannot erase a newer login.
    try { await this.identityTask(() => this.identity.signOut()); } catch { /* screen remains locked */ }
    if (this.current(failureGeneration)) this.publish({ phase: 'error', error: code });
  }
  async logout(): Promise<void> {
    const generation = this.begin(); this.uid = null; this.publish({ phase: 'loading' });
    try { await this.identityTask(() => this.identity.signOut()); } finally { if (this.current(generation)) this.publish({ phase: 'signedOut' }); }
  }
  dispose(): void { this.disposed = true; this.begin(); this.uid = null; this.stopObserving?.(); this.listeners.clear(); this.state = { phase: 'signedOut' }; }
}
