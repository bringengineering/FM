import { FieldApiClient } from './client';
import { FieldError } from '../domain/model';
import type { MobileJob, MobileJobPage } from '../../../functions/src/field-mobile/workspace';
export type { MobileJob, MobileJobPage };
export interface CompanyContext { schemaVersion: 1; actor: { uid: string; role: 'admin' | 'member' }; capabilities: { readJobs: true; capture: false; archiveReport: false; sendCustomerReport: false } }
export interface WorkspaceApi { context(signal: AbortSignal): Promise<CompanyContext>; jobs(cursor: string | null, signal: AbortSignal): Promise<MobileJobPage>; job(id: string, signal: AbortSignal): Promise<MobileJob> }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
function validDate(v: unknown): boolean { if (v === '') return true; if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const parsed = new Date(v + 'T00:00:00Z'); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v; }
function job(value: unknown): MobileJob {
  if (!object(value) || !id(value.id) || !id(value.buildingId) || !text(value.title, 180) || !text(value.buildingName, 180) || !text(value.address, 300)
    || !['assigned', 'doing', 'returned'].includes(String(value.status)) || !validDate(value.startDate) || !validDate(value.dueDate)) throw new FieldError('SERVER_RESPONSE_INVALID');
  // Explicit projection: do not retain unexpected server fields in UI state.
  return { id: value.id, buildingId: value.buildingId, title: value.title as string, buildingName: value.buildingName as string, address: value.address as string, status: value.status as MobileJob['status'], startDate: value.startDate as string, dueDate: value.dueDate as string };
}
export class CompanyWorkspaceApi extends FieldApiClient implements WorkspaceApi {
  async context(signal: AbortSignal): Promise<CompanyContext> {
    const value = await this.request('/context', 'GET', undefined, signal);
    if (!object(value) || value.schemaVersion !== 1 || !object(value.actor) || value.actor.uid !== this.uid || !['admin', 'member'].includes(String(value.actor.role)) || !object(value.capabilities)
      || value.capabilities.readJobs !== true || value.capabilities.capture !== false || value.capabilities.archiveReport !== false || value.capabilities.sendCustomerReport !== false) throw new FieldError('SERVER_RESPONSE_INVALID');
    return { schemaVersion: 1, actor: { uid: this.uid, role: value.actor.role as 'admin' | 'member' }, capabilities: { readJobs: true, capture: false, archiveReport: false, sendCustomerReport: false } };
  }
  async jobs(cursor: string | null, signal: AbortSignal): Promise<MobileJobPage> {
    if (cursor !== null && !id(cursor)) throw new FieldError('REQUEST_INVALID');
    const value = await this.request('/jobs' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), 'GET', undefined, signal);
    if (!object(value) || !Array.isArray(value.jobs) || value.jobs.length > 50 || (value.nextCursor !== null && (!id(value.nextCursor) || value.nextCursor === cursor))) throw new FieldError('SERVER_RESPONSE_INVALID');
    const jobs = value.jobs.map(job);
    if (new Set(jobs.map(j => j.id)).size !== jobs.length) throw new FieldError('SERVER_RESPONSE_INVALID');
    return { jobs, nextCursor: value.nextCursor as string | null };
  }
  async job(jobId: string, signal: AbortSignal): Promise<MobileJob> {
    if (!id(jobId)) throw new FieldError('REQUEST_INVALID');
    const value = await this.request('/jobs/' + jobId, 'GET', undefined, signal);
    if (!object(value)) throw new FieldError('SERVER_RESPONSE_INVALID');
    const selected = job(value.job); if (selected.id !== jobId) throw new FieldError('SERVER_RESPONSE_INVALID'); return selected;
  }
}
