import { describe, expect, it, vi } from "vitest";

import {
  excludeFieldMediaCore,
  type ExcludeFieldMediaDependencies,
} from "../src/field/exclude-field-media.js";

const MEDIA_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-09T00:00:00.000Z";

function media(overrides: Record<string, unknown> = {}) {
  return {
    id: MEDIA_ID,
    buildingId: "b1",
    uploadState: "finalized",
    captureSessionId: "33333333-3333-4333-8333-333333333333",
    zone: "exterior",
    kind: "photo",
    storagePath: `field-media-finalized/b1/${MEDIA_ID}.jpg`,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<ExcludeFieldMediaDependencies> = {},
): ExcludeFieldMediaDependencies & { deleteObject: ReturnType<typeof vi.fn> } {
  return {
    isEnabled: vi.fn(async () => true),
    isAssigned: vi.fn(async () => true),
    readMedia: vi.fn(async () => media()),
    readAudit: vi.fn(async () => null),
    readBuilding: vi.fn(async () => ({
      id: "b1",
      name: "Managed building",
      roadAddress: "1 Test-ro, Wonju",
      latitude: 37.3,
      longitude: 127.9,
      managementContract: {
        status: "active",
        updatedAt: NOW,
        updatedBy: "admin-1",
      },
    })),
    listBuildingListings: vi.fn(async () => []),
    listBuildingMedia: vi.fn(async () => [media()]),
    writePatch: vi.fn(async () => undefined),
    now: () => NOW,
    deleteObject: vi.fn(),
    ...overrides,
  };
}

describe("excludeFieldMediaCore", () => {
  it("excludes finalized media, audits, and rebuilds projection in one update without deleting Storage or Drive", async () => {
    const deps = dependencies();
    await expect(excludeFieldMediaCore(
      { mediaId: MEDIA_ID, requestId: REQUEST_ID },
      { uid: "staff-1", role: "staff" },
      deps,
    )).resolves.toEqual({
      mediaId: MEDIA_ID,
      excludedAt: NOW,
      excludedBy: "staff-1",
    });
    expect(deps.writePatch).toHaveBeenCalledTimes(1);
    const patch = vi.mocked(deps.writePatch).mock.calls[0][0];
    expect(new Set(Object.keys(patch))).toEqual(new Set([
      `fieldPlatform/media/${MEDIA_ID}/excludedAt`,
      `fieldPlatform/media/${MEDIA_ID}/excludedBy`,
      `fieldPlatform/auditLogs/media-excluded-${REQUEST_ID}`,
      "fieldPlatform/mapProjections/b1",
    ]));
    expect(patch[`fieldPlatform/media/${MEDIA_ID}/excludedAt`]).toBe(NOW);
    expect(patch[`fieldPlatform/media/${MEDIA_ID}/excludedBy`]).toBe("staff-1");
    expect(patch[`fieldPlatform/auditLogs/media-excluded-${REQUEST_ID}`])
      .toMatchObject({
        action: "media.excluded",
        entityId: MEDIA_ID,
        actorId: "staff-1",
        requestId: REQUEST_ID,
      });
    const projection = patch["fieldPlatform/mapProjections/b1"] as Record<string, unknown>;
    expect(Object.keys(projection)).toHaveLength(11);
    expect(projection.captureStatus).toBe("inProgress");
    expect(JSON.stringify(projection)).not.toMatch(/field-media|storagePath|staff-1/);
    expect(deps.deleteObject).not.toHaveBeenCalled();
    expect(Object.keys(patch).join("\n")).not.toContain("driveSyncJobs");
  });

  it("returns the identical audit winner without another write", async () => {
    const deps = dependencies({
      readMedia: vi.fn(async () => media({ excludedAt: NOW, excludedBy: "staff-1" })),
      readAudit: vi.fn(async () => ({
        id: `media-excluded-${REQUEST_ID}`,
        action: "media.excluded",
        entityId: MEDIA_ID,
        actorId: "staff-1",
        requestId: REQUEST_ID,
        occurredAt: NOW,
      })),
    });
    await expect(excludeFieldMediaCore(
      { mediaId: MEDIA_ID, requestId: REQUEST_ID },
      { uid: "staff-1", role: "staff" },
      deps,
    )).resolves.toEqual({ mediaId: MEDIA_ID, excludedAt: NOW, excludedBy: "staff-1" });
    expect(deps.writePatch).not.toHaveBeenCalled();
  });

  it("rejects a request ID already used for another media item", async () => {
    const deps = dependencies({
      readAudit: vi.fn(async () => ({
        requestId: REQUEST_ID,
        entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        actorId: "staff-1",
      })),
    });
    await expect(excludeFieldMediaCore(
      { mediaId: MEDIA_ID, requestId: REQUEST_ID },
      { uid: "staff-1", role: "staff" },
      deps,
    )).rejects.toThrow("field_media_exclusion_request_conflict");
    expect(deps.writePatch).not.toHaveBeenCalled();
  });

  it.each([
    ["disabled", "staff" as const, { isEnabled: vi.fn(async () => false) }, "field_media_exclusion_forbidden"],
    ["unassigned", "staff" as const, { isAssigned: vi.fn(async () => false) }, "field_media_exclusion_forbidden"],
    ["not finalized", "staff" as const, { readMedia: vi.fn(async () => media({ uploadState: "objectStored" })) }, "field_media_not_finalized"],
  ])("rejects %s without mutation", async (_label, role, override, code) => {
    const deps = dependencies(override);
    await expect(excludeFieldMediaCore(
      { mediaId: MEDIA_ID, requestId: REQUEST_ID },
      { uid: `${role}-1`, role },
      deps,
    )).rejects.toThrow(code);
    expect(deps.writePatch).not.toHaveBeenCalled();
    expect(deps.deleteObject).not.toHaveBeenCalled();
  });

  it.each(["admin", "reviewer"] as const)(
    "lets an enabled %s bypass assignment",
    async (role) => {
      const deps = dependencies({ isAssigned: vi.fn(async () => false) });
      await expect(excludeFieldMediaCore(
        { mediaId: MEDIA_ID, requestId: REQUEST_ID },
        { uid: `${role}-1`, role },
        deps,
      )).resolves.toMatchObject({ mediaId: MEDIA_ID });
      expect(deps.isAssigned).not.toHaveBeenCalled();
    },
  );
});
