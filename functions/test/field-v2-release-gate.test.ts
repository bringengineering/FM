import { describe, expect, it, vi } from "vitest";

import type { FieldReleaseConfiguration } from "../src/field-v2/contracts.js";
import {
  assertFieldReleaseAllows,
  assertFieldReleaseCompatible,
  compareFieldBuildVersions,
  type FieldReleaseGateDependencies,
} from "../src/field-v2/release-gate.js";

const REQUEST_ID = "8f738cdc-cc9a-4f23-8b27-a87661232806";
const REQUEST_HASH = "a".repeat(64);
const UPLOAD_JOB_ID = "upload_job_1";

const RELEASE_ACTIVE: FieldReleaseConfiguration = {
  protocolVersion: 2,
  minDesktopVersion: "1.8.0",
  maxDesktopVersion: "2.4.0",
  minPwaVersion: "1.7.2",
  enabledOperatorIds: ["operator_kim", "operator_hwang"],
  v2WritesEnabled: true,
  canonicalCrmEnabled: true,
  safeMode: false,
  cutoverAt: "2026-08-14T03:00:00.000Z",
};

describe("FIELD v2 release compatibility", () => {
  it("compares numeric semantic versions rather than lexicographic strings", () => {
    expect(compareFieldBuildVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareFieldBuildVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareFieldBuildVersions("0.9.9", "1.0.0")).toBeLessThan(0);
  });

  it.each(["1.2", "1.2.3-beta", "01.2.3", "1.02.3", "v1.2.3", "1.2.3.4"])(
    "rejects non-strict build version %s",
    (version) => {
      expect(() => compareFieldBuildVersions(version, "1.0.0"))
        .toThrow("field_build_version_invalid");
    },
  );

  it("accepts desktop and PWA builds at their inclusive boundaries", () => {
    expect(assertFieldReleaseCompatible(RELEASE_ACTIVE, {
      protocolVersion: 2,
      clientKind: "desktop",
      buildVersion: "1.8.0",
      operatorId: "operator_kim",
    })).toEqual({ compatible: true });
    expect(assertFieldReleaseCompatible(RELEASE_ACTIVE, {
      protocolVersion: 2,
      clientKind: "desktop",
      buildVersion: "2.4.0",
      operatorId: "operator_hwang",
    })).toEqual({ compatible: true });
    expect(assertFieldReleaseCompatible(RELEASE_ACTIVE, {
      protocolVersion: 2,
      clientKind: "pwa",
      buildVersion: "1.7.2",
      operatorId: "operator_kim",
    })).toEqual({ compatible: true });
  });

  it.each([
    [{ ...RELEASE_ACTIVE, protocolVersion: 3 }, { protocolVersion: 2, clientKind: "desktop", buildVersion: "1.8.0", operatorId: "operator_kim" }, "field_release_config_invalid"],
    [RELEASE_ACTIVE, { protocolVersion: 1, clientKind: "desktop", buildVersion: "1.8.0", operatorId: "operator_kim" }, "field_protocol_mismatch"],
    [RELEASE_ACTIVE, { protocolVersion: 2, clientKind: "desktop", buildVersion: "1.7.9", operatorId: "operator_kim" }, "field_client_upgrade_required"],
    [RELEASE_ACTIVE, { protocolVersion: 2, clientKind: "desktop", buildVersion: "2.4.1", operatorId: "operator_kim" }, "field_client_version_unsupported"],
    [RELEASE_ACTIVE, { protocolVersion: 2, clientKind: "pwa", buildVersion: "1.7.1", operatorId: "operator_kim" }, "field_client_upgrade_required"],
    [RELEASE_ACTIVE, { protocolVersion: 2, clientKind: "desktop", buildVersion: "1.8.0", operatorId: "operator_unknown" }, "field_operator_not_enabled"],
  ] as const)("rejects incompatible release clients", (config, client, code) => {
    expect(() => assertFieldReleaseCompatible(
      config as FieldReleaseConfiguration,
      client,
    )).toThrow(code);
  });

  it.each([
    [{ ...RELEASE_ACTIVE, minDesktopVersion: "1.2" }],
    [{ ...RELEASE_ACTIVE, maxDesktopVersion: "1.7.9" }],
    [{ ...RELEASE_ACTIVE, minPwaVersion: "01.0.0" }],
    [{ ...RELEASE_ACTIVE, enabledOperatorIds: ["operator_kim", "operator_kim"] }],
    [{ ...RELEASE_ACTIVE, cutoverAt: "2026-08-14" }],
  ])("rejects malformed release configuration", (config) => {
    expect(() => assertFieldReleaseCompatible(config, {
      protocolVersion: 2,
      clientKind: "desktop",
      buildVersion: "1.8.0",
      operatorId: "operator_kim",
    })).toThrow("field_release_config_invalid");
  });

  it.each([
    ["null config", null, { protocolVersion: 2, clientKind: "desktop", buildVersion: "1.8.0", operatorId: "operator_kim" }, "field_release_config_invalid"],
    ["undefined config", undefined, { protocolVersion: 2, clientKind: "desktop", buildVersion: "1.8.0", operatorId: "operator_kim" }, "field_release_config_invalid"],
    ["null client", RELEASE_ACTIVE, null, "field_client_invalid"],
    ["undefined client", RELEASE_ACTIVE, undefined, "field_client_invalid"],
  ])("returns a stable domain error for %s", (_label, config, client, code) => {
    expect(() => assertFieldReleaseCompatible(config as never, client as never))
      .toThrow(expect.objectContaining({
        name: "FieldV2Error",
        code,
        message: code,
      }));
  });
});

function gateDependencies(overrides: {
  receipt?: unknown;
  upload?: unknown;
} = {}): FieldReleaseGateDependencies {
  const receipt = Object.hasOwn(overrides, "receipt")
    ? overrides.receipt
    : { scope: "workItems", requestId: REQUEST_ID, requestHash: REQUEST_HASH };
  const upload = Object.hasOwn(overrides, "upload")
    ? overrides.upload
    : { uploadJobId: UPLOAD_JOB_ID, requestId: REQUEST_ID, status: "failed" };
  return {
    readReceipt: vi.fn(async () => receipt),
    readUploadRecovery: vi.fn(async () => upload),
  };
}

async function releaseAllows(
  config: unknown,
  operation: unknown,
  dependencies?: FieldReleaseGateDependencies | null,
) {
  return await assertFieldReleaseAllows(
    config as never,
    operation as never,
    dependencies,
  );
}

describe("FIELD v2 release write gate", () => {
  it("safe mode permits reads and server-proven replay/recovery", async () => {
    const safe = { ...RELEASE_ACTIVE, safeMode: true };
    const dependencies = gateDependencies();
    expect(await releaseAllows(safe, { kind: "read" }))
      .toEqual({ allowed: true });
    expect(await releaseAllows(safe, {
      kind: "receiptReplay",
      scope: "workItems",
      requestId: REQUEST_ID,
      requestHash: REQUEST_HASH,
    }, dependencies)).toEqual({ allowed: true });
    expect(await releaseAllows(safe, {
      kind: "uploadRecovery",
      requestId: REQUEST_ID,
      uploadJobId: UPLOAD_JOB_ID,
    }, dependencies)).toEqual({ allowed: true });
  });

  it("safe mode blocks new work mutations", async () => {
    await expect(releaseAllows(
      { ...RELEASE_ACTIVE, safeMode: true },
      { kind: "createJob", requestId: REQUEST_ID },
    )).rejects.toThrow("field_safe_mode_read_only");
  });

  it("disabled v2 writes still permit proven recovery but block a new mutation", async () => {
    const disabled = { ...RELEASE_ACTIVE, v2WritesEnabled: false };
    expect(await releaseAllows(disabled, {
      kind: "uploadRecovery",
      requestId: REQUEST_ID,
      uploadJobId: UPLOAD_JOB_ID,
    }, gateDependencies())).toEqual({ allowed: true });
    await expect(releaseAllows(disabled, {
      kind: "transitionJob",
      requestId: REQUEST_ID,
    })).rejects.toThrow("field_v2_writes_disabled");
  });

  it("requires the separate canonical CRM switch for canonical writes", async () => {
    await expect(releaseAllows(
      { ...RELEASE_ACTIVE, canonicalCrmEnabled: false },
      { kind: "canonicalCrmWrite", requestId: REQUEST_ID },
    )).rejects.toThrow("field_canonical_crm_disabled");
    expect(await releaseAllows(RELEASE_ACTIVE, {
      kind: "canonicalCrmWrite",
      requestId: REQUEST_ID,
    })).toEqual({ allowed: true });
  });

  it("rejects malformed replay identifiers instead of treating them as exact", async () => {
    await expect(releaseAllows(
      { ...RELEASE_ACTIVE, safeMode: true },
      {
        kind: "receiptReplay",
        scope: "workItems",
        requestId: "not-a-request-id",
        requestHash: REQUEST_HASH,
      },
      gateDependencies(),
    )).rejects.toThrow("field_receipt_replay_invalid");
  });

  it.each([
    [
      "missing dependency",
      undefined,
    ],
    [
      "missing server receipt",
      gateDependencies({ receipt: null }),
    ],
    [
      "wrong stored request ID",
      gateDependencies({
        receipt: {
          scope: "workItems",
          requestId: "28dc7c9e-7f1c-4c4e-969c-b9b940e9e844",
          requestHash: REQUEST_HASH,
        },
      }),
    ],
    [
      "wrong stored fingerprint",
      gateDependencies({
        receipt: {
          scope: "workItems",
          requestId: REQUEST_ID,
          requestHash: "b".repeat(64),
        },
      }),
    ],
    [
      "wrong stored scope",
      gateDependencies({
        receipt: {
          scope: "otherScope",
          requestId: REQUEST_ID,
          requestHash: REQUEST_HASH,
        },
      }),
    ],
    ["malformed server receipt", gateDependencies({ receipt: [] })],
  ])("rejects receipt replay with %s", async (_label, dependencies) => {
    await expect(releaseAllows(
      { ...RELEASE_ACTIVE, safeMode: true },
      {
        kind: "receiptReplay",
        scope: "workItems",
        requestId: REQUEST_ID,
        requestHash: REQUEST_HASH,
      },
      dependencies,
    )).rejects.toThrow("field_receipt_replay_invalid");
  });

  it.each([
    ["blank scope", { scope: "", requestHash: REQUEST_HASH }],
    ["blank hash", { scope: "workItems", requestHash: "" }],
    ["non-SHA-256 hash", { scope: "workItems", requestHash: "abc" }],
  ])("rejects replay lookup with %s", async (_label, override) => {
    await expect(releaseAllows(
      { ...RELEASE_ACTIVE, safeMode: true },
      {
        kind: "receiptReplay",
        requestId: REQUEST_ID,
        ...override,
      },
      gateDependencies(),
    )).rejects.toThrow("field_receipt_replay_invalid");
  });

  it("does not trust a client-shaped receipt embedded in the operation", async () => {
    await expect(releaseAllows(
      { ...RELEASE_ACTIVE, safeMode: true },
      {
        kind: "receiptReplay",
        scope: "workItems",
        requestId: REQUEST_ID,
        requestHash: REQUEST_HASH,
        receipt: {
          scope: "workItems",
          requestId: REQUEST_ID,
          requestHash: REQUEST_HASH,
        },
      },
    )).rejects.toThrow("field_receipt_replay_invalid");
  });

  it.each([
    ["missing dependency", undefined],
    ["missing server job", gateDependencies({ upload: null })],
    [
      "mismatched request ID",
      gateDependencies({
        upload: {
          uploadJobId: UPLOAD_JOB_ID,
          requestId: "28dc7c9e-7f1c-4c4e-969c-b9b940e9e844",
          status: "failed",
        },
      }),
    ],
    [
      "completed server job",
      gateDependencies({
        upload: { uploadJobId: UPLOAD_JOB_ID, requestId: REQUEST_ID, status: "synced" },
      }),
    ],
    ["malformed server job", gateDependencies({ upload: { status: "failed" } })],
  ])("rejects upload recovery with %s", async (_label, dependencies) => {
    await expect(releaseAllows(
      { ...RELEASE_ACTIVE, safeMode: true },
      { kind: "uploadRecovery", requestId: REQUEST_ID, uploadJobId: UPLOAD_JOB_ID },
      dependencies,
    )).rejects.toThrow("field_upload_recovery_invalid");
  });

  it("does not trust a client-shaped upload record embedded in the operation", async () => {
    await expect(releaseAllows(
      { ...RELEASE_ACTIVE, safeMode: true },
      {
        kind: "uploadRecovery",
        requestId: REQUEST_ID,
        uploadJobId: UPLOAD_JOB_ID,
        uploadJob: {
          uploadJobId: UPLOAD_JOB_ID,
          requestId: REQUEST_ID,
          status: "failed",
        },
      },
    )).rejects.toThrow("field_upload_recovery_invalid");
  });

  it.each([
    ["null config", null, { kind: "read" }, "field_release_config_invalid"],
    ["undefined config", undefined, { kind: "read" }, "field_release_config_invalid"],
    ["null operation", RELEASE_ACTIVE, null, "field_release_operation_invalid"],
    ["undefined operation", RELEASE_ACTIVE, undefined, "field_release_operation_invalid"],
  ])("returns a stable domain error for %s", async (_label, config, operation, code) => {
    await expect(releaseAllows(config, operation)).rejects.toMatchObject({
      name: "FieldV2Error",
      code,
      message: code,
    });
  });
});
