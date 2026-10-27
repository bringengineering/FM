import { FieldApiClient } from './client';
import { FieldError } from '../domain/model';
import type { CustomerSite, CustomerSitePage } from '../../../functions/src/field-mobile/sites';
export type { CustomerSite, CustomerSitePage };
export interface CompanySiteContext { schemaVersion: 1; actor: { uid: string; role: 'admin' | 'member' }; capabilities: { readCustomerSites: true; capture: false; archiveReport: false; sendCustomerReport: false } }
export interface SiteWorkspaceApi { context(signal: AbortSignal): Promise<CompanySiteContext>; sites(cursor: string | null, signal: AbortSignal): Promise<CustomerSitePage>; site(id: string, signal: AbortSignal): Promise<CustomerSite> }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
function site(value: unknown): CustomerSite {
  if (!object(value) || !id(value.id) || value.customerId !== value.id || !text(value.name, 180) || !value.name || !text(value.address, 500)) throw new FieldError('SERVER_RESPONSE_INVALID');
  return { id: value.id, customerId: value.id, name: value.name as string, address: value.address as string };
}
export class CompanySiteApi extends FieldApiClient implements SiteWorkspaceApi {
  async context(signal: AbortSignal): Promise<CompanySiteContext> {
    const value = await this.request('/context', 'GET', undefined, signal);
    if (!object(value) || value.schemaVersion !== 1 || !object(value.actor) || value.actor.uid !== this.uid || !['admin', 'member'].includes(String(value.actor.role)) || !object(value.capabilities)
      || value.capabilities.readCustomerSites !== true || value.capabilities.capture !== false || value.capabilities.archiveReport !== false || value.capabilities.sendCustomerReport !== false) throw new FieldError('SERVER_RESPONSE_INVALID');
    return { schemaVersion: 1, actor: { uid: this.uid, role: value.actor.role as 'admin' | 'member' }, capabilities: { readCustomerSites: true, capture: false, archiveReport: false, sendCustomerReport: false } };
  }
  async sites(cursor: string | null, signal: AbortSignal): Promise<CustomerSitePage> {
    if (cursor !== null && !id(cursor)) throw new FieldError('REQUEST_INVALID');
    const value = await this.request('/sites' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), 'GET', undefined, signal);
    if (!object(value) || !Array.isArray(value.sites) || value.sites.length > 50 || (value.nextCursor !== null && (!id(value.nextCursor) || value.nextCursor === cursor))) throw new FieldError('SERVER_RESPONSE_INVALID');
    const sites = value.sites.map(site);
    if (new Set(sites.map(s => s.id)).size !== sites.length) throw new FieldError('SERVER_RESPONSE_INVALID');
    return { sites, nextCursor: value.nextCursor as string | null };
  }
  async site(customerId: string, signal: AbortSignal): Promise<CustomerSite> {
    if (!id(customerId)) throw new FieldError('REQUEST_INVALID');
    const value = await this.request('/sites/' + customerId, 'GET', undefined, signal);
    if (!object(value)) throw new FieldError('SERVER_RESPONSE_INVALID');
    const selected = site(value.site); if (selected.id !== customerId) throw new FieldError('SERVER_RESPONSE_INVALID'); return selected;
  }
}
