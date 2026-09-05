const PACKAGE_ID_PATTERN =
  /^ad-package-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export type AdPackageRecoveryStatus = "reviewed" | "failed" | "generating";

function canonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_ISO_PATTERN.test(value)) {
    return false;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === value;
}

function validStatus(value: unknown): value is AdPackageRecoveryStatus {
  return value === "reviewed" || value === "failed" || value === "generating";
}

export function buildAdPackageRecoveryKey(
  status: AdPackageRecoveryStatus,
  dueAt: string,
  packageId: string,
): string {
  if (
    !validStatus(status)
    || !canonicalIso(dueAt)
    || !PACKAGE_ID_PATTERN.test(packageId)
  ) {
    throw new Error("ad_package_recovery_key_invalid");
  }
  return `${status}|${dueAt}|${packageId}`;
}

export function adPackageRecoveryRange(
  status: AdPackageRecoveryStatus,
  dueAtOrBefore: string,
): { startAt: string; endAt: string } {
  if (!validStatus(status) || !canonicalIso(dueAtOrBefore)) {
    throw new Error("ad_package_recovery_range_invalid");
  }
  return {
    startAt: `${status}|`,
    endAt: `${status}|${dueAtOrBefore}|\uf8ff`,
  };
}
