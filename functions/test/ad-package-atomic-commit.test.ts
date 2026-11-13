import { describe, expect, it } from "vitest";

import {
  reduceAdPackageCommit,
  type AdPackageCommitInput,
} from "../src/packages/create-ad-package.js";

const REQUEST = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-10T05:00:00.000Z";
const STORAGE_MD5_BASE64 = "1B2M2Y8AsgTpgAmY7PhCfg==";
const DRIVE_MD5_HEX = "d41d8cd98f00b204e9800998ecf8427e";
const MEDIA_IDS = Array.from({ length: 10 }, (_, index) =>
  `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
);
const ZONES = [
  ["exterior", "photo"],
  ["accessRoad", "photo"],
  ["commonEntrance", "photo"],
  ["roomOverview", "photo"],
  ["roomOverview", "photo"],
  ["windowDaylight", "photo"],
  ["kitchen", "photo"],
  ["bathroom", "photo"],
  ["boilerEquipment", "photo"],
  ["verticalVideo", "video"],
] as const;

function media(id: string, index: number) {
  const [zone, kind] = ZONES[index];
  const mimeType = kind === "photo" ? "image/jpeg" : "video/mp4";
  const extension = kind === "photo" ? "jpg" : "mp4";
  return {
    id,
    buildingId: "building-1",
    unitId: "unit-1",
    listingId: "listing-1",
    captureSessionId: SESSION,
    kind,
    zone,
    slotId: `slot-${index + 1}`,
    required: true,
    mimeType,
    sizeBytes: 2_048,
    capturedAt: `2026-08-10T04:${String(index).padStart(2, "0")}:00.000Z`,
    storagePath: `field-media-finalized/building-1/${id}.${extension}`,
    objectGeneration: String(10_000 + index),
    objectMd5Hash: STORAGE_MD5_BASE64,
    uploadState: "finalized",
    captureQualityState: kind === "video" ? "valid" : undefined,
  };
}

function state() {
  return {
    untouched: { keep: true },
    buildings: {
      "building-1": {
        id: "building-1",
        managementNumber: "BR-001",
        name: "Bring House",
        roadAddress: "1 Bring-ro, Wonju",
        parking: { available: true, totalSpaces: 4 },
      },
    },
    units: {
      "unit-1": {
        id: "unit-1",
        buildingId: "building-1",
        unitLabel: "201",
        options: ["air conditioner"],
      },
    },
    listings: {
      "listing-1": {
        id: "listing-1",
        buildingId: "building-1",
        unitId: "unit-1",
        unitLabel: "201",
        status: "ready",
        advertisingApproved: true,
        depositWon: 5_000_000,
        monthlyRentWon: 450_000,
        maintenanceFeeWon: 50_000,
        maintenanceFeeItems: ["water"],
        availableFrom: "2026-08-11",
        locationDescription: "terminal five minutes away",
        parkingDescription: "one car",
        petPolicy: "ask owner",
        options: ["air conditioner"],
      },
    },
    captureSessions: {
      [SESSION]: {
        id: SESSION,
        buildingId: "building-1",
        unitId: "unit-1",
        listingId: "listing-1",
        status: "complete",
      },
    },
    media: Object.fromEntries(MEDIA_IDS.map((id, index) => [id, media(id, index)])),
    adPackages: {},
    auditLogs: {},
    adPackageVersions: {},
  };
}

function input(overrides: Partial<AdPackageCommitInput> = {}): AdPackageCommitInput {
  return {
    requestId: REQUEST,
    listingId: "listing-1",
    approvedMediaIds: MEDIA_IDS,
    representativeMediaIds: [MEDIA_IDS[0], MEDIA_IDS[1]],
    actorId: "reviewer-1",
    occurredAt: NOW,
    ...overrides,
  };
}

describe("reduceAdPackageCommit", () => {
  it("atomically writes version, package, audit, and media review state", () => {
    const decision = reduceAdPackageCommit(state(), input());

    expect(decision.status).toBe("committed");
    expect(decision.write).toBe(true);
    expect(decision.result).toEqual({
      packageId: `ad-package-${REQUEST}`,
      listingId: "listing-1",
      version: 1,
      status: "reviewed",
    });
    const next = decision.state as ReturnType<typeof state> & Record<string, any>;
    expect(next.untouched).toEqual({ keep: true });
    expect(next.adPackageVersions["listing-1"]).toBe(1);
    expect(next.adPackageLatest["listing-1"]).toBe(`ad-package-${REQUEST}`);
    expect(next.adPackages[`ad-package-${REQUEST}`]).toMatchObject({
      requestId: REQUEST,
      listingId: "listing-1",
      version: 1,
      status: "reviewed",
      artifactSetVersion: 1,
      sourceFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      generation: {
        status: "reviewed",
        attemptCount: 0,
        generationNumber: 0,
        sourceFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        updatedAt: NOW,
      },
      createdBy: "reviewer-1",
      allApprovedMediaIds: MEDIA_IDS,
      buildingId: "building-1",
      captureSessionId: SESSION,
    });
    expect(next.adPackages[`ad-package-${REQUEST}`].mediaManifest[0])
      .toMatchObject({
        buildingId: "building-1",
        captureSessionId: SESSION,
        driveMd5Checksum: DRIVE_MD5_HEX,
      });
    expect(next.adPackages[`ad-package-${REQUEST}`].mediaManifest[0])
      .not.toHaveProperty("objectMd5Hash");
    expect(next.adPackages[`ad-package-${REQUEST}`].generation.sourceFingerprint)
      .toBe(next.adPackages[`ad-package-${REQUEST}`].sourceFingerprint);
    expect(next.auditLogs[`ad-package-created-${REQUEST}`]).toMatchObject({
      requestId: REQUEST,
      actorId: "reviewer-1",
    });
    expect(next.media[MEDIA_IDS[0]]).toMatchObject({
      advertisingApproved: true,
      advertisingOrder: 1,
    });
  });

  it("allocates consecutive versions for distinct requests", () => {
    const first = reduceAdPackageCommit(state(), input());
    const secondRequest = "44444444-4444-4444-8444-444444444444";
    const second = reduceAdPackageCommit(first.state, input({ requestId: secondRequest }));
    expect(second).toMatchObject({ status: "committed", result: { version: 2 } });
    expect((second.state as any).adPackageVersions["listing-1"]).toBe(2);
    expect((second.state as any).adPackageLatest["listing-1"])
      .toBe(`ad-package-${secondRequest}`);
  });

  it("replays an identical receipt even after mutable source data changes", () => {
    const first = reduceAdPackageCommit(state(), input());
    const mutated = structuredClone(first.state) as any;
    mutated.listings["listing-1"].status = "closed";
    delete mutated.media[MEDIA_IDS[0]];

    const replay = reduceAdPackageCommit(mutated, input());
    expect(replay).toMatchObject({
      status: "alreadyCommitted",
      write: false,
      result: { version: 1, status: "reviewed" },
    });
    expect(replay.state).toBe(mutated);
  });

  it("replays the original create receipt while artifact generation is failed", () => {
    const first = reduceAdPackageCommit(state(), input());
    const failed = structuredClone(first.state) as any;
    const pkg = failed.adPackages[`ad-package-${REQUEST}`];
    pkg.status = "failed";
    pkg.generation = {
      status: "failed",
      attemptCount: 1,
      generationNumber: 1,
      sourceFingerprint: pkg.sourceFingerprint,
      failedAt: "2026-08-10T05:01:00.000Z",
      updatedAt: "2026-08-10T05:01:00.000Z",
      nextAttemptAt: "2026-08-10T05:01:30.000Z",
      lastErrorCode: "ad_package_generation_failed",
    };

    expect(reduceAdPackageCommit(failed, input())).toMatchObject({
      status: "alreadyCommitted",
      write: false,
      result: { version: 1 },
    });
  });

  it("rejects request-id reuse with a changed actor or payload", () => {
    const first = reduceAdPackageCommit(state(), input());
    expect(reduceAdPackageCommit(first.state, input({ actorId: "admin-1" })))
      .toMatchObject({ status: "requestConflict", write: false });
    expect(reduceAdPackageCommit(first.state, input({ representativeMediaIds: [MEDIA_IDS[2]] })))
      .toMatchObject({ status: "requestConflict", write: false });
  });

  it.each(["draft", "reviewPending", "capturing", "closed"])(
    "rejects listing status %s",
    (status) => {
      const current = state() as any;
      current.listings["listing-1"].status = status;
      expect(() => reduceAdPackageCommit(current, input()))
        .toThrow("ad_package_listing_incomplete");
    },
  );

  it.each([
    ["wrong final path", { storagePath: "field-media-finalized/building-1/wrong.jpg" }],
    ["noncanonical timestamp", { capturedAt: "2026-08-10 04:00:00" }],
    ["invalid generation", { objectGeneration: "0" }],
    ["malformed base64 MD5", { objectMd5Hash: "not-base64" }],
    ["wrong-length base64 MD5", { objectMd5Hash: "YWJjZA==" }],
    ["oversize photo", { sizeBytes: 26 * 1_024 * 1_024 }],
    ["wrong listing binding", { listingId: "listing-2" }],
  ])("rejects media with %s", (_label, patch) => {
    const current = state() as any;
    Object.assign(current.media[MEDIA_IDS[0]], patch);
    expect(() => reduceAdPackageCommit(current, input()))
      .toThrow("ad_package_approved_media_invalid");
    expect(current.adPackages).toEqual({});
    expect(current.adPackageVersions).toEqual({});
  });

  it("rejects unbounded allowlisted output strings and arrays", () => {
    const long = "가".repeat(1_000);
    const current = state() as any;
    current.listings["listing-1"].locationDescription = long;
    expect(() => reduceAdPackageCommit(current, input()))
      .toThrow("ad_package_listing_incomplete");

    const tooMany = state() as any;
    tooMany.units["unit-1"].options = Array.from({ length: 51 }, (_, i) => `option-${i}`);
    expect(() => reduceAdPackageCommit(tooMany, input()))
      .toThrow("ad_package_listing_incomplete");
  });

  it("never projects secret source fields into the package", () => {
    const current = state() as any;
    current.buildings["building-1"].ownerPhone = "010-SECRET";
    current.units["unit-1"].unitDoorPassword = "DOOR-SECRET";
    current.listings["listing-1"].internalMemo = "MEMO-SECRET";
    current.media[MEDIA_IDS[0]].captureNote = "CAPTURE-SECRET";
    const decision = reduceAdPackageCommit(current, input());
    const serialized = JSON.stringify((decision.state as any).adPackages);
    expect(serialized).not.toMatch(/010-SECRET|DOOR-SECRET|MEMO-SECRET|CAPTURE-SECRET/);
  });

  it("accepts shared building-scope media when omitted unit/listing bindings are proven by the session", () => {
    const current = state() as any;
    for (const id of MEDIA_IDS.slice(0, 3)) {
      delete current.media[id].unitId;
      delete current.media[id].listingId;
    }

    expect(reduceAdPackageCommit(current, input())).toMatchObject({
      status: "committed",
      result: { version: 1 },
    });
  });

  it("atomically clears omitted approvals from every capture session bound to the listing", () => {
    const current = state() as any;
    const oldSession = "55555555-5555-4555-8555-555555555555";
    const oldMedia = "66666666-6666-4666-8666-666666666666";
    current.captureSessions[oldSession] = {
      id: oldSession,
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      status: "complete",
    };
    current.media[oldMedia] = {
      id: oldMedia,
      buildingId: "building-1",
      captureSessionId: oldSession,
      kind: "photo",
      zone: "exterior",
      advertisingApproved: true,
      advertisingOrder: 99,
    };
    const foreignSession = "77777777-7777-4777-8777-777777777777";
    const foreignMedia = "88888888-8888-4888-8888-888888888888";
    current.captureSessions[foreignSession] = {
      id: foreignSession,
      buildingId: "building-1",
      unitId: "unit-2",
      listingId: "listing-2",
      status: "complete",
    };
    current.media[foreignMedia] = {
      id: foreignMedia,
      buildingId: "building-1",
      captureSessionId: foreignSession,
      kind: "photo",
      zone: "exterior",
      advertisingApproved: true,
      advertisingOrder: 77,
    };

    const decision = reduceAdPackageCommit(current, input());
    expect((decision.state as any).media[oldMedia]).toMatchObject({
      advertisingApproved: false,
    });
    expect((decision.state as any).media[oldMedia]).not.toHaveProperty(
      "advertisingOrder",
    );
    expect(current.media[oldMedia]).toMatchObject({
      advertisingApproved: true,
      advertisingOrder: 99,
    });
    expect((decision.state as any).media[foreignMedia]).toMatchObject({
      advertisingApproved: true,
      advertisingOrder: 77,
    });
  });
});
