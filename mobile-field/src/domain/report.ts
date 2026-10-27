import type { ItemStatus, Photo, Visit } from './model';

interface Item { key: string; label: string; detail: string; status: ItemStatus; note: string; before: unknown[]; during: unknown[]; after: unknown[] }
interface Report { id: string; items: Item[]; [key: string]: unknown }
interface Core {
  itemCatalogFor(kind: string): { key: string; label: string; detail: string }[];
  normalizeReport(input: unknown): Report;
  blockers(input: unknown): { key: string; text: string }[];
  validateReport(input: unknown): { ok: boolean; error?: string };
}
// This is the existing UMD module; no Electron/DOM imports are required.
const core: Core = require('../../../desktop-crm/src/work-report-core.js');
export const catalog = (kind: string) => core.itemCatalogFor(kind);
export function toReport(visit: Visit, photos: Photo[]): Report {
  const selected = photos.filter(p => p.visitId === visit.id && p.ownerUid === visit.ownerUid && p.included);
  return core.normalizeReport({
    id: visit.id, buildingId: visit.job.buildingId, customerId: visit.job.customerId, buildingName: visit.job.title,
    kind: visit.job.kind, siteAddress: visit.job.address, workDate: visit.job.workDate,
    summary: visit.draft.summary, followUp: visit.draft.followUp,
    items: catalog(visit.job.kind).map(item => ({ ...item,
      status: visit.draft.statuses[item.key] ?? 'recorded', note: visit.draft.notes[item.key] ?? '',
      ...Object.fromEntries(['before', 'during', 'after'].map(phase => [phase, selected.filter(p => p.itemKey === item.key && p.phase === phase).map(p => ({ id: p.id, caption: p.caption }))])),
    })),
  });
}
export const reportIssues = (visit: Visit, photos: Photo[]) => core.blockers(toReport(visit, photos));
export function reviewIssues(visit: Visit, photos: Photo[]): string[] {
  const issues = reportIssues(visit, photos).map(issue => issue.text);
  const validation = core.validateReport(toReport(visit, photos));
  if (!validation.ok && validation.error && !issues.includes(validation.error)) issues.push(validation.error);
  return issues;
}
