// A gallery photo keeps the time it was taken, not the time it was added.
// Only the date tags are read; every other EXIF value (GPS, device, owner) is
// ignored here and the re-encoded JPEG stores no EXIF at all.
// The PDF pairs before/after photos by this time, so a wrong value moves a
// photo to the wrong place. Anything doubtful falls back to "now".
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;
const OFFSET = /^([+-])(\d{2}):(\d{2})$/;
const MAX_AGE_MS = 366 * 24 * 60 * 60 * 1000, MAX_FUTURE_MS = 10 * 60 * 1000;

export function exifCapturedAt(exif: unknown, now: Date = new Date()): string {
  const fallback = now.toISOString();
  if (!exif || typeof exif !== 'object') return fallback;
  const tags = exif as Record<string, unknown>;
  const raw = [tags.DateTimeOriginal, tags.DateTimeDigitized].find(value => typeof value === 'string' && EXIF_DATE.test(value.trim())) as string | undefined;
  if (!raw) return fallback;
  const [, y, mo, d, h, mi, s] = EXIF_DATE.exec(raw.trim())!.map(Number) as number[];
  // Reject impossible dates (2026:02:31) instead of letting Date roll them over.
  const probe = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!, s!));
  if (h! > 23 || mi! > 59 || s! > 59 || probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo! - 1 || probe.getUTCDate() !== d) return fallback;
  const offsetText = [tags.OffsetTimeOriginal, tags.OffsetTime].find(value => typeof value === 'string' && OFFSET.test(value.trim())) as string | undefined;
  let time: number;
  if (offsetText) {
    const [, sign, oh, om] = OFFSET.exec(offsetText.trim())!;
    const offsetMs = (Number(oh) * 60 + Number(om)) * 60_000 * (sign === '-' ? -1 : 1);
    time = Date.UTC(y!, mo! - 1, d!, h!, mi!, s!) - offsetMs;
  } else {
    // No offset tag: the camera wrote local wall-clock time on this device.
    time = new Date(y!, mo! - 1, d!, h!, mi!, s!).getTime();
  }
  if (!Number.isFinite(time) || time > now.getTime() + MAX_FUTURE_MS || time < now.getTime() - MAX_AGE_MS) return fallback;
  return new Date(time).toISOString();
}
