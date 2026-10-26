import { authorizeMobileJob, type MobileActor } from './access.js';

export interface MobileJob {
  id: string; buildingId: string; title: string; buildingName: string; address: string;
  status: 'assigned' | 'doing' | 'returned'; startDate: string; dueDate: string;
}
export interface MobileJobPage { jobs: MobileJob[]; nextCursor: string | null }
export interface WorkspaceReads {
  // The adapter must page the canonical work order index, not a client claim.
  listOrders(actor: MobileActor, after: string | null, limit: number): Promise<{ key: string; value: unknown }[]>;
  readOrder(id: string): Promise<unknown>;
  readBuilding(id: string): Promise<unknown>;
}
export class WorkspaceError extends Error {
  constructor(readonly code: 'REQUEST_INVALID' | 'JOB_NOT_FOUND' | 'SERVICE_UNAVAILABLE') { super(code); }
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const safeId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v) && !['__proto__', 'prototype', 'constructor'].includes(v);
const text = (v: unknown, max: number): string => typeof v === 'string' && v.trim().length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : '';
const active = (v: Record<string, unknown>) => v.archived !== true && v.deleted !== true && !v.archivedAt && !v.deletedAt;
const staffUid = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v) && !['__proto__', 'prototype', 'constructor'].includes(v);
function date(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
  const parsed = new Date(v + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v ? v : '';
}
async function project(actor: MobileActor, key: string, value: unknown, reads: WorkspaceReads): Promise<MobileJob | null> {
  if (!safeId(key) || !record(value) || value.id !== key || !active(value) || !safeId(value.buildingId)
    || !staffUid(value.assigneeUid) || !['assigned', 'doing', 'returned'].includes(String(value.status))) return null;
  try { authorizeMobileJob(actor, { id: key, buildingId: value.buildingId, active: true, assignedUids: [value.assigneeUid] }); }
  catch { return null; }
  // No building/customer read is allowed before the canonical assignment check.
  const building = await reads.readBuilding(value.buildingId);
  if (!record(building) || building.id !== value.buildingId || !active(building)) return null;
  const title = text(value.title, 180), buildingName = text(building.name, 180);
  const address = text(building.roadAddress, 300) || text(building.address, 300);
  if (!title || !buildingName || !address) return null;
  return { id: key, buildingId: value.buildingId, title, buildingName, address,
    status: value.status as MobileJob['status'], startDate: date(value.startDate), dueDate: date(value.dueDate) };
}
export async function listMobileJobs(actor: MobileActor, cursor: string | null, reads: WorkspaceReads): Promise<MobileJobPage> {
  if (cursor !== null && !safeId(cursor)) throw new WorkspaceError('REQUEST_INVALID');
  const rows = await reads.listOrders(actor, cursor, 51);
  if (!Array.isArray(rows) || rows.length > 51 || rows.some(row => !safeId(row.key)) || new Set(rows.map(row => row.key)).size !== rows.length) throw new WorkspaceError('SERVICE_UNAVAILABLE');
  const page = rows.slice(0, 50), jobs: MobileJob[] = [];
  for (const row of page) { const job = await project(actor, row.key, row.value, reads); if (job) jobs.push(job); }
  // Advance over excluded/closed orders too, so one invalid record cannot trap pagination.
  return { jobs, nextCursor: rows.length > 50 ? page[page.length - 1]!.key : null };
}
export async function getMobileJob(actor: MobileActor, id: string, reads: WorkspaceReads): Promise<MobileJob> {
  if (!safeId(id)) throw new WorkspaceError('REQUEST_INVALID');
  const job = await project(actor, id, await reads.readOrder(id), reads);
  if (!job) throw new WorkspaceError('JOB_NOT_FOUND');
  return job;
}
