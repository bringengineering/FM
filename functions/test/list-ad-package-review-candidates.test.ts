import { describe, expect, it, vi } from "vitest";

import {
  listAdPackageReviewCandidatesCore,
  type ListAdPackageReviewCandidatesDependencies,
} from "../src/packages/list-ad-package-review-candidates.js";

function listing(id: string, status: "reviewPending" | "ready" | "advertising" = "ready") {
  return {
    id,
    buildingId: `building-${id}`,
    unitId: `unit-${id}`,
    unitLabel: "201",
    status,
    advertisingApproved: true,
    depositWon: 5_000_000,
    monthlyRentWon: 450_000,
    maintenanceFeeWon: 50_000,
    maintenanceFeeItems: ["water"],
    availableFrom: "2026-08-11",
    locationDescription: "near terminal",
    parkingDescription: "one car",
    petPolicy: "ask owner",
    options: ["air conditioner"],
    ownerPhone: "SECRET-OWNER",
  };
}

function dependencies(
  overrides: Partial<ListAdPackageReviewCandidatesDependencies> = {},
): ListAdPackageReviewCandidatesDependencies {
  return {
    isEnabled: vi.fn(async () => true),
    listListingsByStatus: vi.fn(async (status, limit) =>
      status === "ready" ? [listing("listing-1")] : []),
    readBuilding: vi.fn(async (id) => ({
      id,
      managementNumber: "BR-001",
      name: "Bring House",
      roadAddress: "1 Bring-ro, Wonju",
      parking: { available: true },
      commonDoorPassword: "SECRET-DOOR",
    })),
    readUnit: vi.fn(async (id) => ({
      id,
      buildingId: "building-listing-1",
      unitLabel: "201",
      options: [],
      keyLocation: "SECRET-KEY",
    })),
    listMediaByListing: vi.fn(async () => []),
    listMediaByBuilding: vi.fn(async () => [{
      id: "33333333-3333-4333-8333-000000000001",
      buildingId: "building-listing-1",
      captureSessionId: "22222222-2222-4222-8222-222222222222",
      kind: "photo",
      zone: "exterior",
      slotId: "exterior-1",
      required: true,
      mimeType: "image/jpeg",
      sizeBytes: 2_048,
      capturedAt: "2026-08-10T04:00:00.000Z",
      storagePath: "field-media-finalized/building-listing-1/33333333-3333-4333-8333-000000000001.jpg",
      objectGeneration: "100",
      uploadState: "finalized",
      advertisingApproved: true,
      captureNote: "SECRET-CAPTURE",
    }, {
      id: "33333333-3333-4333-8333-000000000099",
      buildingId: "building-listing-1",
      captureSessionId: "99999999-9999-4999-8999-999999999999",
      kind: "photo",
      zone: "exterior",
      slotId: "foreign-exterior",
      required: true,
      mimeType: "image/jpeg",
      sizeBytes: 2_048,
      capturedAt: "2026-08-10T03:00:00.000Z",
      storagePath: "field-media-finalized/building-listing-1/33333333-3333-4333-8333-000000000099.jpg",
      objectGeneration: "99",
      uploadState: "finalized",
      advertisingApproved: true,
    }]),
    readCaptureSession: vi.fn(async (id) => id === "99999999-9999-4999-8999-999999999999"
      ? {
          id,
          buildingId: "building-listing-1",
          unitId: "unit-listing-2",
          listingId: "listing-2",
          status: "complete",
        }
      : {
          id,
          buildingId: "building-listing-1",
          unitId: "unit-listing-1",
          listingId: "listing-1",
          status: "complete",
          privateNote: "SECRET-SESSION",
        }),
    listPackagesByListing: vi.fn(async () => [{
      id: "ad-package-old",
      listingId: "listing-1",
      version: 2,
      representativeMediaIds: [],
      allApprovedMediaIds: [],
      status: "complete",
      driveFolderId: "SECRET-DRIVE",
    }]),
    readLatestPackageId: vi.fn(async () => null),
    readPackage: vi.fn(async () => null),
    ...overrides,
  };
}

describe("listAdPackageReviewCandidatesCore", () => {
  it("uses bounded indexed dependency calls and returns only allowlisted fields", async () => {
    const deps = dependencies();
    const result = await listAdPackageReviewCandidatesCore(
      undefined,
      { uid: "reviewer-1", role: "reviewer" },
      deps,
    );

    expect(deps.listListingsByStatus).toHaveBeenCalledTimes(3);
    expect(deps.listListingsByStatus).toHaveBeenCalledWith("reviewPending", 50);
    expect(deps.listListingsByStatus).toHaveBeenCalledWith("ready", 50);
    expect(deps.listListingsByStatus).toHaveBeenCalledWith("advertising", 50);
    expect(deps.listMediaByListing).toHaveBeenCalledWith("listing-1", 100);
    expect(deps.listMediaByBuilding).toHaveBeenCalledWith("building-listing-1", 100);
    expect(deps.readCaptureSession).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(deps.listPackagesByListing).toHaveBeenCalledWith("listing-1", 20);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].media).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      listing: { id: "listing-1", status: "ready" },
      building: { id: "building-listing-1", name: "Bring House" },
      unit: { id: "unit-listing-1" },
      media: [{ id: "33333333-3333-4333-8333-000000000001" }],
      captureSessions: [{ id: "22222222-2222-4222-8222-222222222222" }],
      packages: [{ id: "ad-package-old", listingId: "listing-1", version: 2 }],
    });
    expect(JSON.stringify(result)).not.toMatch(/SECRET-/);
  });

  it("caps deduplicated candidates at 50", async () => {
    const rows = Array.from({ length: 60 }, (_, index) =>
      listing(`listing-${String(index).padStart(2, "0")}`));
    const deps = dependencies({
      listListingsByStatus: vi.fn(async (status) => status === "ready" ? rows : []),
      readBuilding: vi.fn(async (id) => ({
        id,
        managementNumber: id,
        name: id,
        roadAddress: "Wonju",
        parking: { available: false },
      })),
      readUnit: vi.fn(async (id) => ({
        id,
        buildingId: id.replace("unit-", "building-"),
        unitLabel: "201",
        options: [],
      })),
      listMediaByListing: vi.fn(async () => []),
      listMediaByBuilding: vi.fn(async () => []),
      listPackagesByListing: vi.fn(async () => []),
    });

    const result = await listAdPackageReviewCandidatesCore(
      {},
      { uid: "admin-1", role: "admin" },
      deps,
    );
    expect(result.candidates).toHaveLength(50);
    expect(deps.readBuilding).toHaveBeenCalledTimes(50);
  });

  it("paginates beyond 50 candidates without overlap", async () => {
    const rows = Array.from({ length: 60 }, (_, index) =>
      listing(`listing-${String(index).padStart(2, "0")}`));
    const deps = dependencies({
      listListingsByStatus: vi.fn(async (status, limit, cursor?: string) =>
        status === "ready"
          ? rows.filter((row) => cursor === undefined || row.id > cursor).slice(0, limit)
          : []),
      readBuilding: vi.fn(async (id) => ({
        id,
        managementNumber: id,
        name: id,
        roadAddress: "Wonju",
        parking: { available: false },
      })),
      readUnit: vi.fn(async (id) => ({
        id,
        buildingId: id.replace("unit-", "building-"),
        unitLabel: "201",
        options: [],
      })),
      listMediaByListing: vi.fn(async () => []),
      listMediaByBuilding: vi.fn(async () => []),
      listPackagesByListing: vi.fn(async () => []),
    });

    const first = await listAdPackageReviewCandidatesCore(
      {},
      { uid: "admin-1", role: "admin" },
      deps,
    );
    expect(first.candidates).toHaveLength(50);
    expect((first as any).nextCursor).toBe("listing-49");

    const second = await listAdPackageReviewCandidatesCore(
      { cursor: (first as any).nextCursor },
      { uid: "admin-1", role: "admin" },
      deps,
    );
    expect(second.candidates).toHaveLength(10);
    expect((second as any).nextCursor).toBeUndefined();
    expect(second.candidates.map((candidate: any) => candidate.listing.id))
      .toEqual(rows.slice(50).map((row) => row.id));
  });

  it("advances across a full page of invalid raw listings", async () => {
    const invalidRows = Array.from({ length: 50 }, (_, index) => ({
      ...listing(`listing-${String(index).padStart(2, "0")}`),
      parkingDescription: undefined,
    }));
    const validRow = listing("listing-50");
    const rows = [...invalidRows, validRow];
    const deps = dependencies({
      listListingsByStatus: vi.fn(async (status, limit, cursor?: string) =>
        status === "ready"
          ? rows.filter((row) => cursor === undefined || row.id > cursor).slice(0, limit)
          : []),
      readBuilding: vi.fn(async (id) => ({
        id,
        managementNumber: id,
        name: id,
        roadAddress: "Wonju",
        parking: { available: false },
      })),
      readUnit: vi.fn(async (id) => ({
        id,
        buildingId: id.replace("unit-", "building-"),
        unitLabel: "201",
        options: [],
      })),
      listMediaByListing: vi.fn(async () => []),
      listMediaByBuilding: vi.fn(async () => []),
      listPackagesByListing: vi.fn(async () => []),
    });

    const first = await listAdPackageReviewCandidatesCore(
      {},
      { uid: "admin-1", role: "admin" },
      deps,
    );
    expect(first).toEqual({ candidates: [], nextCursor: "listing-49" });

    const second = await listAdPackageReviewCandidatesCore(
      { cursor: first.nextCursor },
      { uid: "admin-1", role: "admin" },
      deps,
    );
    expect(second.candidates.map((candidate: any) => candidate.listing.id))
      .toEqual(["listing-50"]);
  });

  it("uses Firebase key order for mixed-case status-page merging", async () => {
    const fillers = Array.from({ length: 49 }, (_, index) =>
      listing(`listing-${String(index).padStart(2, "0")}`));
    const readyRows = [...fillers, listing("listing_a")];
    const advertisingRows = [listing("listing_Z", "advertising")];
    const deps = dependencies({
      listListingsByStatus: vi.fn(async (status, limit, cursor?: string) => {
        const rows = status === "ready"
          ? readyRows
          : status === "advertising"
            ? advertisingRows
            : [];
        return rows.filter((row) => cursor === undefined || row.id > cursor)
          .slice(0, limit);
      }),
      readBuilding: vi.fn(async (id) => ({
        id,
        managementNumber: id,
        name: id,
        roadAddress: "Wonju",
        parking: { available: false },
      })),
      readUnit: vi.fn(async (id) => ({
        id,
        buildingId: id.replace("unit-", "building-"),
        unitLabel: "201",
        options: [],
      })),
      listMediaByListing: vi.fn(async () => []),
      listMediaByBuilding: vi.fn(async () => []),
      listPackagesByListing: vi.fn(async () => []),
    });

    const first = await listAdPackageReviewCandidatesCore(
      {},
      { uid: "admin-1", role: "admin" },
      deps,
    );
    expect(first.nextCursor).toBe("listing_Z");
    expect(first.candidates.map((candidate: any) => candidate.listing.id))
      .toEqual([...fillers.map((row) => row.id), "listing_Z"]);

    const second = await listAdPackageReviewCandidatesCore(
      { cursor: first.nextCursor },
      { uid: "admin-1", role: "admin" },
      deps,
    );
    expect(second.candidates.map((candidate: any) => candidate.listing.id))
      .toEqual(["listing_a"]);
  });

  it("merges the atomic latest-package pointer ahead of bounded history", async () => {
    const latestPackage = {
      id: "ad-package-latest",
      listingId: "listing-1",
      version: 99,
      representativeMediaIds: [],
      allApprovedMediaIds: [],
      status: "reviewed",
      secretWorkerToken: "SECRET-LATEST",
    };
    const deps = {
      ...dependencies(),
      readLatestPackageId: vi.fn(async () => latestPackage.id),
      readPackage: vi.fn(async () => latestPackage),
    } as any;

    const result = await listAdPackageReviewCandidatesCore(
      {},
      { uid: "reviewer-1", role: "reviewer" },
      deps,
    );

    expect(result.candidates[0].packages.map((item: any) => item.id))
      .toEqual(["ad-package-latest", "ad-package-old"]);
    expect(JSON.stringify(result)).not.toContain("SECRET-LATEST");
  });

  it.each([
    ["staff", true],
    ["reviewer", false],
  ] as const)("blocks %s or disabled actors before candidate queries", async (role, enabled) => {
    const deps = dependencies({ isEnabled: vi.fn(async () => enabled) });
    await expect(listAdPackageReviewCandidatesCore(
      {},
      { uid: `${role}-1`, role },
      deps,
    )).rejects.toThrow("ad_package_forbidden");
    expect(deps.listListingsByStatus).not.toHaveBeenCalled();
  });

  it("rejects unsupported or unsafe cursor input", async () => {
    const deps = dependencies();
    await expect(listAdPackageReviewCandidatesCore(
      { limit: 999 },
      { uid: "reviewer-1", role: "reviewer" },
      deps,
    )).rejects.toThrow("ad_review_candidates_invalid");
    await expect(listAdPackageReviewCandidatesCore(
      { cursor: "unsafe/path" },
      { uid: "reviewer-1", role: "reviewer" },
      deps,
    )).rejects.toThrow("ad_review_candidates_invalid");
  });

  it("accepts the callable protocol's null no-input payload", async () => {
    const deps = dependencies();
    await expect(listAdPackageReviewCandidatesCore(
      null,
      { uid: "reviewer-1", role: "reviewer" },
      deps,
    )).resolves.toHaveProperty("candidates");
  });

  it("filters numeric generations and path-unsafe slot ids before the client sees them", async () => {
    const base = {
      id: "44444444-4444-4444-8444-444444444444",
      buildingId: "building-listing-1",
      unitId: "unit-listing-1",
      listingId: "listing-1",
      captureSessionId: "22222222-2222-4222-8222-222222222222",
      kind: "photo",
      zone: "roomOverview",
      slotId: "room-1",
      required: true,
      mimeType: "image/jpeg",
      sizeBytes: 2_048,
      capturedAt: "2026-08-10T04:00:00.000Z",
      storagePath: "field-media-finalized/building-listing-1/44444444-4444-4444-8444-444444444444.jpg",
      objectGeneration: 100,
      uploadState: "finalized",
      advertisingApproved: true,
    };
    const unsafeSlot = {
      ...base,
      id: "55555555-5555-4555-8555-555555555555",
      slotId: "unsafe/path",
      objectGeneration: "101",
      storagePath: "field-media-finalized/building-listing-1/55555555-5555-4555-8555-555555555555.jpg",
    };
    const deps = dependencies({
      listMediaByListing: vi.fn(async () => [base, unsafeSlot]),
      listMediaByBuilding: vi.fn(async () => []),
    });

    const result = await listAdPackageReviewCandidatesCore(
      {},
      { uid: "reviewer-1", role: "reviewer" },
      deps,
    );
    expect(result.candidates[0].media).toEqual([]);
    expect(result.candidates[0].captureSessions).toEqual([]);
  });
});
