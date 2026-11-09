import type { ItemStatus, Photo, Visit, Workspace } from './model';

interface Item { key: string; label: string; detail: string; status: ItemStatus; note: string; before: unknown[]; during: unknown[]; after: unknown[] }
interface Report { id: string; items: Item[]; [key: string]: unknown }
interface Core {
  commonZoneFor(key: string): string;
  legacyCommonPlan(areas: unknown, statuses: unknown, notes: unknown): string[];
  itemCatalogFor(kind: string): { key: string; label: string; detail: string; optional?: boolean }[];
  normalizeReport(input: unknown): Report;
  blockers(input: unknown): { key: string; text: string }[];
  validateReport(input: unknown): { ok: boolean; error?: string };
}
// This is the existing UMD module; no Electron/DOM imports are required.
const core: Core = require('../../../desktop-crm/src/work-report-core.js');
export const catalog = (kind: string) => core.itemCatalogFor(kind);
export const zoneFor = (kind: string, key: string) => kind === 'common' ? core.commonZoneFor(key) : key;
// 공용부 구역을 양식의 9개로 줄이기 전(앱 0.1.15 이하)에 기기에 저장한 방문은 불러올 때 지금 구역으로 읽는다.
// 기기 저장값은 바꾸지 않는다. 사진을 고치거나 방문을 저장하면 그때 새 구역 이름으로 저장되고,
// 예전 이름으로 올라간 사진도 서버가 같은 표로 옮긴다.
export function withCurrentZones(workspace: Workspace): Workspace {
  const common = new Set(workspace.visits.filter(v => v.job.kind === 'common').map(v => v.id));
  if (!common.size) return workspace;
  const zone = (key: string) => core.commonZoneFor(key);
  const rank: Record<string, number> = { done: 3, partial: 2, skipped: 1, recorded: 0 };
  const stronger = (a: string, b: string) => (rank[b] ?? -1) > (rank[a] ?? -1) ? b : a;
  const legacy = (v: Visit) => [...(v.captureAreas ?? []), ...Object.keys(v.draft.statuses), ...Object.keys(v.draft.notes)].some(key => zone(key) !== key);
  const merge = (record: Record<string, string>, pick: (a: string, b: string) => string) => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) { const k = zone(key); out[k] = k in out ? pick(out[k]!, value) : value; }
    return out;
  };
  return {
    visits: workspace.visits.map(v => !common.has(v.id) ? v : { ...v,
      ...(!v.legacyArchive && v.captureAreas?.length && legacy(v) ? { legacyArchive: { revision: v.revision, plan: core.legacyCommonPlan(v.captureAreas, v.draft.statuses, v.draft.notes) } } : {}),
      ...(v.captureAreas ? { captureAreas: [...new Set(v.captureAreas.map(zone))] } : {}),
      draft: { ...v.draft, statuses: merge(v.draft.statuses, stronger) as Visit['draft']['statuses'], notes: merge(v.draft.notes, (a, b) => [a, b].filter(Boolean).join(' / ').slice(0, 500)) } }),
    photos: workspace.photos.map(p => common.has(p.visitId) ? { ...p, itemKey: zone(p.itemKey) } : p),
  };
}
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
