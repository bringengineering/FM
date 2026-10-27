/** Work locations come from CRM customer addresses, without a building/order link. */
export interface CustomerSite { id: string; customerId: string; name: string; address: string }
export interface CustomerSitePage { sites: CustomerSite[]; nextCursor: string | null }
export interface CustomerSiteReads {
  listCustomers(after: string | null, limit: number): Promise<{ key: string; value: unknown }[]>;
  readCustomer(id: string): Promise<unknown>;
}
export class SiteError extends Error {
  constructor(readonly code: 'REQUEST_INVALID' | 'SITE_NOT_FOUND' | 'SERVICE_UNAVAILABLE') { super(code); }
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const siteId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v) && !['__proto__', 'prototype', 'constructor'].includes(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : '';
function project(key: string, value: unknown): CustomerSite | null {
  if (!siteId(key) || !record(value) || value.id !== key || value.archived === true || value.deleted === true || value.archivedAt || value.deletedAt) return null;
  return { id: key, customerId: key,
    name: text(value.nickname, 80) || text(value.name, 180) || text(value.company, 180) || '이름 미입력 고객',
    address: text(value.roadAddress, 500) || text(value.address, 500) || text(value.jibunAddress, 500) };
}
// Requires the active office-account boundary. CRM office members can read
// company customers; never infer a customer identity from names or addresses.
export async function listCustomerSites(cursor: string | null, reads: CustomerSiteReads): Promise<CustomerSitePage> {
  if (cursor !== null && !siteId(cursor)) throw new SiteError('REQUEST_INVALID');
  const rows = await reads.listCustomers(cursor, 51);
  if (!Array.isArray(rows) || rows.length > 51 || rows.some(row => !siteId(row.key)) || new Set(rows.map(row => row.key)).size !== rows.length) throw new SiteError('SERVICE_UNAVAILABLE');
  const page = rows.slice(0, 50);
  return { sites: page.map(row => project(row.key, row.value)).filter((site): site is CustomerSite => !!site), nextCursor: rows.length > 50 ? page[page.length - 1]!.key : null };
}
export async function getCustomerSite(id: string, reads: CustomerSiteReads): Promise<CustomerSite> {
  if (!siteId(id)) throw new SiteError('REQUEST_INVALID');
  const site = project(id, await reads.readCustomer(id));
  if (!site) throw new SiteError('SITE_NOT_FOUND');
  return site;
}
