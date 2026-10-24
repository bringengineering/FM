import type { CleaningOrderRecord, CleaningOrderServiceType } from "./contracts.js";

type ChecklistDefinition = {
  reportKind: string;
  requiredKeys: readonly string[];
  optionalKeys?: readonly string[];
};

const checklists: Readonly<Record<CleaningOrderServiceType, ChecklistDefinition>> = Object.freeze({
  move_in_cleaning: {
    reportKind: "moveIn",
    requiredKeys: ["floor", "window", "kitchen", "bath", "veranda", "storage", "finish"],
    optionalKeys: ["hood", "aircon", "refrigerator"],
  },
  move_out_cleaning: {
    reportKind: "moveOut",
    requiredKeys: ["floor", "window", "kitchen", "bath", "veranda", "storage", "waste", "finish"],
    optionalKeys: ["appliances"],
  },
  common_cleaning: {
    reportKind: "common",
    requiredKeys: ["entrance", "corridor", "stairs", "handrail", "windows", "lighting", "recycle", "final"],
  },
  stair_cleaning: {
    reportKind: "stairs",
    requiredKeys: ["stairFloor", "handrail", "stairWindow", "light", "entrance", "recycle"],
  },
  other: {
    reportKind: "general",
    requiredKeys: ["scope", "before", "work", "waste", "after"],
  },
});

const COMPLETION_EVIDENCE_REQUIRED = { ok: false, error: "cleaning_order_completion_evidence_required" } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isGoogleDriveViewLink(value: unknown, expectedDriveFileId: string): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const pathFileId = /\/d\/([A-Za-z0-9_-]{6,200})(?:\/|$)/u.exec(url.pathname)?.[1];
    const linkedFileId = url.searchParams.get("id") || pathFileId;
    return linkedFileId === expectedDriveFileId
      && url.protocol === "https:"
      && !url.username && !url.password && !url.port
      && (url.hostname === "drive.google.com" || url.hostname === "docs.google.com");
  } catch {
    return false;
  }
}

function verifiedPhotoFileIdsIn(values: unknown, verifiedDriveFileIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap(value => isRecord(value)
    && typeof value.id === "string" && value.id.trim().length > 0 && value.id.length <= 80
    && typeof value.driveFileId === "string" && /^[A-Za-z0-9_-]{6,200}$/u.test(value.driveFileId)
    && verifiedDriveFileIds.has(value.driveFileId)
    && isGoogleDriveViewLink(value.webViewLink, value.driveFileId)
    ? [value.driveFileId]
    : []);
}

function isReadyReport(order: CleaningOrderRecord, report: unknown, checklist: ChecklistDefinition, latestWorkStart: string, verifiedPhotoFileIds: ReadonlySet<string>): report is Record<string, unknown> {
  if (!isRecord(report)
    || typeof report.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/u.test(report.id)
    || report.cleaningOrderId !== order.id
    || report.buildingId !== order.buildingId
    || report.kind !== checklist.reportKind
    || !isValidDate(report.workDate)
    || !isCanonicalTimestamp(report.updatedAt)
    || report.updatedAt < latestWorkStart
    || !Array.isArray(report.items)) return false;

  const allowedKeys = new Set([...checklist.requiredKeys, ...(checklist.optionalKeys || [])]);
  const seenKeys = new Set<string>();
  let hasPerformedWork = false;
  for (const rawItem of report.items) {
    if (!isRecord(rawItem)
      || typeof rawItem.key !== "string"
      || !allowedKeys.has(rawItem.key)
      || seenKeys.has(rawItem.key)
      || !["done", "partial", "skipped"].includes(String(rawItem.status))) return false;
    seenKeys.add(rawItem.key);
    if (rawItem.status === "skipped") {
      if (typeof rawItem.note !== "string" || rawItem.note.trim().length === 0) return false;
      continue;
    }
    hasPerformedWork = true;
    if (rawItem.status === "done") {
      const beforeFileIds = verifiedPhotoFileIdsIn(rawItem.before, verifiedPhotoFileIds);
      const afterFileIds = verifiedPhotoFileIdsIn(rawItem.after, verifiedPhotoFileIds);
      if (!beforeFileIds.length || !afterFileIds.length
        || !beforeFileIds.some(beforeId => afterFileIds.some(afterId => beforeId !== afterId))) return false;
    }
  }

  return hasPerformedWork && checklist.requiredKeys.every(key => seenKeys.has(key));
}

export function validateCleaningOrderCompletionEvidence(
  order: CleaningOrderRecord,
  reports: unknown,
  verifiedPhotoFileIds: ReadonlySet<string> = new Set(),
): { ok: true; reportId: string } | { ok: false; error: "cleaning_order_completion_evidence_required" } {
  const checklist = checklists[order.serviceType];
  if (!checklist || order.status !== "review_pending" || !Array.isArray(order.history)) return COMPLETION_EVIDENCE_REQUIRED;
  const latestWorkStart = [...order.history].reverse().find(entry => entry.status === "in_progress")?.changedAt;
  if (!isCanonicalTimestamp(latestWorkStart)) return COMPLETION_EVIDENCE_REQUIRED;
  if (!Array.isArray(reports)) return COMPLETION_EVIDENCE_REQUIRED;
  const report = reports.find(candidate => isReadyReport(order, candidate, checklist, latestWorkStart, verifiedPhotoFileIds));
  return report ? { ok: true, reportId: String((report as Record<string, unknown>).id) } : COMPLETION_EVIDENCE_REQUIRED;
}

export function collectCleaningOrderCompletionPhotoFileIds(orderId: string, reports: unknown): string[] | null {
  if (!Array.isArray(reports)) return null;
  const ids = new Set<string>();
  for (const report of reports) {
    if (!isRecord(report) || report.cleaningOrderId !== orderId || !Array.isArray(report.items)) continue;
    if (report.items.length > 32) return null;
    for (const item of report.items) {
      if (!isRecord(item)) continue;
      for (const side of [item.before, item.after]) {
        if (!Array.isArray(side)) continue;
        if (side.length > 20) return null;
        for (const photo of side) {
          if (!isRecord(photo) || typeof photo.driveFileId !== "string") continue;
          if (!/^[A-Za-z0-9_-]{6,200}$/u.test(photo.driveFileId)) continue;
          ids.add(photo.driveFileId);
          if (ids.size > 64) return null;
        }
      }
    }
  }
  return [...ids];
}

export function cleaningReportChecklistContract(): Readonly<Record<CleaningOrderServiceType, ChecklistDefinition>> {
  return checklists;
}
