import { describe, expect, it } from "vitest";

import type { FieldReleaseConfiguration } from "../src/field-v2/contracts.js";
import {
  assertFieldReleaseAllows,
  assertFieldReleaseCompatible,
  compareFieldBuildVersions,
} from "../src/field-v2/release-gate.js";

const REQUEST_ID = "8f738cdc-cc9a-4f23-8b27-a87661232806";

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
});

describe("FIELD v2 release write gate", () => {
  it("safe mode permits reads, exact receipt replay, and upload recovery", () => {
    const safe = { ...RELEASE_ACTIVE, safeMode: true };
    expect(assertFieldReleaseAllows(safe, { kind: "read" }))
      .toEqual({ allowed: true });
    expect(assertFieldReleaseAllows(safe, {
      kind: "receiptReplay",
      requestId: REQUEST_ID,
    })).toEqual({ allowed: true });
    expect(assertFieldReleaseAllows(safe, {
      kind: "uploadRecovery",
      requestId: REQUEST_ID,
    })).toEqual({ allowed: true });
  });

  it("safe mode blocks new work mutations", () => {
    expect(() => assertFieldReleaseAllows(
      { ...RELEASE_ACTIVE, safeMode: true },
      { kind: "createJob", requestId: REQUEST_ID },
    )).toThrow("field_safe_mode_read_only");
  });

  it("disabled v2 writes still permit recovery but block a new mutation", () => {
    const disabled = { ...RELEASE_ACTIVE, v2WritesEnabled: false };
    expect(assertFieldReleaseAllows(disabled, {
      kind: "uploadRecovery",
      requestId: REQUEST_ID,
    })).toEqual({ allowed: true });
    expect(() => assertFieldReleaseAllows(disabled, {
      kind: "transitionJob",
      requestId: REQUEST_ID,
    })).toThrow("field_v2_writes_disabled");
  });

  it("requires the separate canonical CRM switch for canonical writes", () => {
    expect(() => assertFieldReleaseAllows(
      { ...RELEASE_ACTIVE, canonicalCrmEnabled: false },
      { kind: "canonicalCrmWrite", requestId: REQUEST_ID },
    )).toThrow("field_canonical_crm_disabled");
    expect(assertFieldReleaseAllows(RELEASE_ACTIVE, {
      kind: "canonicalCrmWrite",
      requestId: REQUEST_ID,
    })).toEqual({ allowed: true });
  });

  it("rejects malformed replay identifiers instead of treating them as exact", () => {
    expect(() => assertFieldReleaseAllows(
      { ...RELEASE_ACTIVE, safeMode: true },
      { kind: "receiptReplay", requestId: "not-a-request-id" },
    )).toThrow("field_release_operation_invalid");
  });
});
