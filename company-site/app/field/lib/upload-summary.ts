import type { QueuedMediaRecord } from "./offline-queue";

export interface UploadSummary {
  todayTotal: number;
  uploading: number;
  completedToday: number;
  failed: number;
  progressPercent: number;
}

export const EMPTY_UPLOAD_SUMMARY: UploadSummary = {
  todayTotal: 0,
  uploading: 0,
  completedToday: 0,
  failed: 0,
  progressPercent: 0,
};

const seoulDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dateKey(value: string): string | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? seoulDate.format(date) : null;
}

function progress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function isComplete(record: QueuedMediaRecord): boolean {
  return record.descriptor.uploadState === "finalized"
    && record.driveSyncState === "complete";
}

function isFailed(record: QueuedMediaRecord): boolean {
  return record.descriptor.uploadState === "failed"
    || record.driveSyncState === "failed";
}

export function summarizeUploadRecords(
  records: QueuedMediaRecord[],
  now = new Date().toISOString(),
): UploadSummary {
  if (records.length === 0) return EMPTY_UPLOAD_SUMMARY;
  const todayKey = dateKey(now);
  const today = todayKey === null
    ? []
    : records.filter((record) => dateKey(record.descriptor.capturedAt) === todayKey);
  const totalProgress = today.reduce(
    (sum, record) => sum + progress(record.descriptor.uploadProgress),
    0,
  );

  return {
    todayTotal: today.length,
    uploading: records.filter((record) => (
      !isFailed(record) && !isComplete(record)
    )).length,
    completedToday: today.filter(isComplete).length,
    failed: records.filter(isFailed).length,
    progressPercent: today.length === 0
      ? 0
      : Math.round(totalProgress / today.length),
  };
}
