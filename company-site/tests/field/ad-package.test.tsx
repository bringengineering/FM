import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AdPackageReview from "../../app/field/components/AdPackageReview";
import { FieldSessionProvider } from "../../app/field/components/FieldSessionContext";
import {
  AD_PACKAGE_SOURCE_PATHS,
  analyzeAdPackageReadiness,
  buildAdPackagePreview,
  loadAdPackageReviewCandidates,
  normalizeAdPackageReviewWorkspace,
  type AdPackageReviewCandidate,
  type AdPackageReviewWorkspacePage,
} from "../../app/field/lib/ad-package";
import {
  createAdPackage,
  loadAdReviewWorkspace,
  type CreateAdPackageResult,
} from "../../app/field/lib/field-api.client";

const NOW = "2026-08-10T03:00:00.000Z";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const REQUIRED_SLOTS = [
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

function candidate(): AdPackageReviewCandidate {
  return {
    listing: {
      id: "listing-1",
      buildingId: "building-1",
      unitId: "unit-1",
      unitLabel: "201",
      status: "ready",
      advertisingApproved: true,
      depositWon: 5_000_000,
      monthlyRentWon: 450_000,
      maintenanceFeeWon: 50_000,
      maintenanceFeeItems: ["수도", "인터넷"],
      availableFrom: "2026-08-10",
      locationDescription: "터미널 도보 5분",
      parkingDescription: "1대 가능",
      petPolicy: "협의 가능",
      options: ["에어컨", "세탁기"],
    },
    building: {
      id: "building-1",
      managementNumber: "BR-0001",
      name: "브링하우스",
      roadAddress: "강원 원주시 브링로 1",
      parking: { available: true, totalSpaces: 8 },
      elevator: true,
    },
    unit: {
      id: "unit-1",
      buildingId: "building-1",
      unitLabel: "201",
      structure: "투룸",
      floor: 2,
      direction: "남향",
      options: ["에어컨", "세탁기"],
    },
    media: [
      ...REQUIRED_SLOTS.map(([zone, kind], index) => ({
        id: `media-${index + 1}`,
        buildingId: "building-1",
        unitId: "unit-1",
        listingId: "listing-1",
        captureSessionId: SESSION_ID,
        kind,
        zone,
        slotId: `${zone}-${index}`,
        required: true,
        mimeType: kind === "photo" ? "image/jpeg" : "video/mp4",
        sizeBytes: 1_000 + index,
        capturedAt: `2026-08-10T01:${String(index).padStart(2, "0")}:00.000Z`,
        storagePath: `field-media-finalized/building-1/media-${index + 1}.${kind === "photo" ? "jpg" : "mp4"}`,
        uploadState: "finalized" as const,
        advertisingApproved: true,
        captureQualityState: "valid" as const,
        objectGeneration: `generation-${index + 1}`,
        objectMd5Hash: `md5-${index + 1}`,
        ...(index < 2 ? { advertisingOrder: index + 1 } : {}),
      })),
      {
        id: "media-optional",
        buildingId: "building-1",
        unitId: "unit-1",
        listingId: "listing-1",
        captureSessionId: SESSION_ID,
        kind: "photo",
        zone: "parking",
        slotId: "parking-optional",
        required: false,
        mimeType: "image/jpeg",
        sizeBytes: 2_000,
        capturedAt: "2026-08-10T02:00:00.000Z",
        storagePath: "field-media-finalized/building-1/media-optional.jpg",
        uploadState: "finalized",
        advertisingApproved: true,
        captureQualityState: "valid",
        objectGeneration: "generation-optional",
        objectMd5Hash: "md5-optional",
      },
    ],
    captureSessions: [{
      id: SESSION_ID,
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      status: "complete",
    }],
    packages: [],
  };
}

function candidateWithId(id: string, name: string): AdPackageReviewCandidate {
  const value = candidate();
  return {
    ...value,
    listing: { ...value.listing, id },
    building: { ...value.building, name },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("advertising review loader", () => {
  it("reads only the six advertising roots and keeps eligible listings and finalized media", async () => {
    const data: Record<string, unknown> = {
      "fieldPlatform/listings": {
        "listing-1": candidate().listing,
        "listing-draft": { ...candidate().listing, id: "listing-draft", status: "draft" },
      },
      "fieldPlatform/buildings": { "building-1": candidate().building },
      "fieldPlatform/units": { "unit-1": candidate().unit },
      "fieldPlatform/media": {
        "media-1": candidate().media[0],
        "building-scope": {
          ...candidate().media[1],
          id: "building-scope",
          zone: "accessRoad",
          unitId: undefined,
          listingId: undefined,
        },
        "wrong-unit": {
          ...candidate().media[3],
          id: "wrong-unit",
          unitId: "unit-2",
        },
        "missing-listing": {
          ...candidate().media[4],
          id: "missing-listing",
          listingId: undefined,
        },
        queued: { ...candidate().media[1], id: "queued", uploadState: "queued" },
        excluded: { ...candidate().media[2], id: "excluded", excludedAt: NOW },
      },
      "fieldPlatform/adPackages": {},
      "fieldPlatform/captureSessions": {
        [SESSION_ID]: candidate().captureSessions[0],
        "missing-unit": {
          ...candidate().captureSessions[0],
          id: "missing-unit",
          unitId: undefined,
        },
        "missing-listing": {
          ...candidate().captureSessions[0],
          id: "missing-listing",
          listingId: undefined,
        },
        "wrong-unit": {
          ...candidate().captureSessions[0],
          id: "wrong-unit",
          unitId: "unit-2",
        },
        "wrong-listing": {
          ...candidate().captureSessions[0],
          id: "wrong-listing",
          listingId: "listing-2",
        },
      },
      "fieldPlatform/secureAccess": { secret: "DO-NOT-READ" },
      "fieldPlatform/ownerNotes": { secret: "DO-NOT-READ" },
    };
    const readPath = vi.fn(async (path: string) => data[path]);

    const result = await loadAdPackageReviewCandidates(readPath);

    expect(readPath.mock.calls.map(([path]) => path)).toEqual(AD_PACKAGE_SOURCE_PATHS);
    expect(readPath).not.toHaveBeenCalledWith(expect.stringMatching(/secureAccess|ownerNotes/));
    expect(result).toHaveLength(1);
    expect(result[0].listing.id).toBe("listing-1");
    expect(result[0].media.map((item) => item.id)).toEqual(["media-1", "building-scope"]);
    expect(result[0].media[0]).toMatchObject({
      captureQualityState: "valid",
      objectGeneration: "generation-1",
      objectMd5Hash: "md5-1",
    });
    expect(result[0].captureSessions.map((session) => session.id)).toEqual([SESSION_ID]);
  });
});

describe("createAdPackage client", () => {
  it("sends the exact reviewed media payload and validates the response", async () => {
    const invoke = vi.fn(async () => ({ data: {
      packageId: "package-1",
      listingId: "listing-1",
      version: 2,
      status: "reviewed" as const,
    } }));
    const input = {
      requestId: REQUEST_ID,
      listingId: "listing-1",
      approvedMediaIds: ["media-1", "media-2"],
      representativeMediaIds: ["media-2", "media-1"],
    };

    await expect(createAdPackage(input, invoke)).resolves.toEqual({
      packageId: "package-1",
      listingId: "listing-1",
      version: 2,
      status: "reviewed",
    });
    expect(invoke).toHaveBeenCalledWith(input);
  });
});

describe("advertising review callable client", () => {
  it("normalizes an allowlisted page, preserves a safe cursor, and discards unknown fields", () => {
    const rawCandidate = candidate();
    const result = normalizeAdPackageReviewWorkspace({
      candidates: [{
        ...rawCandidate,
        secureAccess: { ownerPhone: "010-0000-0000" },
        ownerNotes: { note: "private" },
        listing: { ...rawCandidate.listing, privateMemo: "discard me" },
        media: rawCandidate.media.map((item) => ({ ...item, internalToken: "discard me" })),
      }],
      nextCursor: "listing-050",
      internalDebug: "discard me",
    });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ nextCursor: "listing-050" });
    expect(result?.candidates).toHaveLength(1);
    expect(result?.candidates[0]).not.toHaveProperty("secureAccess");
    expect(result?.candidates[0]).not.toHaveProperty("ownerNotes");
    expect(result?.candidates[0].listing).not.toHaveProperty("privateMemo");
    expect(result?.candidates[0].media[0]).not.toHaveProperty("internalToken");
    expect(result).not.toHaveProperty("internalDebug");
  });

  it.each([
    { candidates: [], nextCursor: "" },
    { candidates: [], nextCursor: " unsafe" },
    { candidates: [], nextCursor: "unsafe/path" },
    { candidates: [], nextCursor: "x".repeat(129) },
    { candidates: "not-an-array" },
  ])("rejects an invalid workspace page %#", (value) => {
    expect(normalizeAdPackageReviewWorkspace(value)).toBeNull();
  });

  it("sends exact first and next-page callable payloads", async () => {
    const rawCandidate = candidate();
    const invoke = vi.fn(async () => ({
      data: {
        candidates: [{
          ...rawCandidate,
          secureAccess: { ownerPhone: "010-0000-0000" },
          ownerNotes: { note: "private" },
          listing: { ...rawCandidate.listing, privateMemo: "discard me" },
          media: rawCandidate.media.map((item) => ({ ...item, internalToken: "discard me" })),
        }],
        nextCursor: "listing-050",
      },
    }));

    const first = await loadAdReviewWorkspace({}, invoke);
    const second = await loadAdReviewWorkspace({ cursor: "listing-050" }, invoke);

    expect(invoke).toHaveBeenNthCalledWith(1, {});
    expect(invoke).toHaveBeenNthCalledWith(2, { cursor: "listing-050" });
    expect(first.candidates).toHaveLength(1);
    expect(second.nextCursor).toBe("listing-050");
  });
});

describe("advertising readiness", () => {
  it("requires a listing to finish review before package generation", () => {
    const review = candidate();
    review.listing.status = "reviewPending";

    const result = analyzeAdPackageReadiness(
      review,
      review.media.map((item) => item.id),
      ["media-1", "media-2"],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/검토 완료|광고 준비 상태/);
  });

  it("requires approved fields and every required zone from one complete session", () => {
    const ready = candidate();
    const approvedIds = ready.media.map((item) => item.id);
    const representatives = ["media-1", "media-2"];

    expect(analyzeAdPackageReadiness(ready, approvedIds, representatives))
      .toEqual({ ready: true, reasons: [] });

    const mixedSessions = {
      ...ready,
      media: ready.media.map((item, index) => ({
        ...item,
        captureSessionId: index < 5 ? SESSION_ID : "other-session",
      })),
      captureSessions: [
        ...ready.captureSessions,
        {
          id: "other-session",
          buildingId: "building-1",
          unitId: "unit-1",
          listingId: "listing-1",
          status: "complete" as const,
        },
      ],
    };
    const result = analyzeAdPackageReadiness(
      mixedSessions,
      approvedIds,
      representatives,
    );
    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/하나의 완료된 촬영 세션/);
  });

  it("rejects a vertical video whose capture quality is not valid", () => {
    const review = candidate();
    review.media = review.media.map((item) => item.zone === "verticalVideo"
      ? { ...item, captureQualityState: "warning" as const }
      : item);

    const result = analyzeAdPackageReadiness(
      review,
      review.media.map((item) => item.id),
      ["media-1", "media-2"],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/세로영상.*검증/);
  });

  it("requires every approved media item to come from the same completed session", () => {
    const review = candidate();
    review.media = review.media.map((item) => item.id === "media-optional"
      ? { ...item, captureSessionId: "other-session" }
      : item);
    review.captureSessions.push({
      id: "other-session",
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      status: "complete",
    });

    const result = analyzeAdPackageReadiness(
      review,
      review.media.map((item) => item.id),
      ["media-1", "media-2"],
    );

    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/하나의 완료된 촬영 세션/);
  });

  it("does not duplicate the Korean room suffix in preview copy", () => {
    const review = candidate();
    review.unit.unitLabel = "201호";

    expect(buildAdPackagePreview(review, [], []).daangnDescription)
      .toContain("브링하우스 201호\n");
    expect(buildAdPackagePreview(review, [], []).daangnDescription)
      .not.toContain("201호호");
  });
});

describe("AdPackageReview", () => {
  it("shows staff a permission explanation without loading advertising data", async () => {
    const load = vi.fn(async () => ({ candidates: [candidate()] }));
    render(
      <FieldSessionProvider session={{ uid: "staff-1", displayName: "직원", role: "staff" }}>
        <AdPackageReview
          load={load}
          create={vi.fn()}
          exclude={vi.fn()}
          mediaAccess={vi.fn()}
        />
      </FieldSessionProvider>,
    );

    expect(screen.getByRole("heading", { name: "광고 패키지 검토 권한이 필요합니다" }))
      .toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });

  it("lets a reviewer order representative photos, exclude media, preview text, and create", async () => {
    const load = vi.fn(async () => ({ candidates: [candidate()] }));
    const create = vi.fn(async () => ({
      packageId: "package-1",
      listingId: "listing-1",
      version: 1,
      status: "reviewed" as const,
    }));
    const exclude = vi.fn(async () => ({
      mediaId: "media-optional",
      excludedAt: NOW,
      excludedBy: "reviewer-1",
    }));
    const mediaAccess = vi.fn(async (mediaId: string) => ({
      url: `https://signed.example/${mediaId}`,
      expiresAt: "2026-08-10T04:00:00.000Z",
    }));
    const confirmExclude = vi.fn(() => true);

    render(
      <FieldSessionProvider session={{ uid: "reviewer-1", displayName: "검토자", role: "reviewer" }}>
        <AdPackageReview
          load={load}
          create={create}
          exclude={exclude}
          mediaAccess={mediaAccess}
          confirmExclude={confirmExclude}
          createId={() => REQUEST_ID}
        />
      </FieldSessionProvider>,
    );

    expect(await screen.findByRole("heading", { name: "광고 패키지 검토" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "더 보기" })).not.toBeInTheDocument();
    expect(screen.getByText("브링하우스 · 201호")).toBeInTheDocument();
    await waitFor(() => expect(mediaAccess).toHaveBeenCalledTimes(candidate().media.length));
    expect(screen.getByLabelText("광고 포함 media-1")).toBeChecked();

    const orderList = screen.getByRole("list", { name: "대표사진 순서" });
    expect(within(orderList).getAllByRole("listitem").map((item) => item.textContent))
      .toEqual(expect.arrayContaining([expect.stringContaining("media-1"), expect.stringContaining("media-2")]));
    const moveDown = within(orderList).getByRole("button", { name: "media-1 아래로 이동" });
    expect(moveDown.querySelector("svg")).not.toBeNull();
    fireEvent.click(moveDown);

    fireEvent.click(screen.getByRole("button", { name: "media-optional 제외" }));
    await waitFor(() => expect(exclude).toHaveBeenCalledWith({
      mediaId: "media-optional",
      requestId: REQUEST_ID,
    }));
    expect(confirmExclude).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("광고 포함 media-optional")).not.toBeInTheDocument();

    expect(screen.getByRole("region", { name: "당근 설명 미리보기" }))
      .toHaveTextContent("보증금 5,000,000원");
    expect(screen.getByRole("region", { name: "네이버 입력정보 미리보기" }))
      .toHaveTextContent("월세");

    fireEvent.click(screen.getByRole("button", { name: "광고 패키지 생성" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      listingId: "listing-1",
      approvedMediaIds: candidate().media
        .map((item) => item.id)
        .filter((id) => id !== "media-optional"),
      representativeMediaIds: ["media-2", "media-1"],
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("1버전 생성 요청 완료");
  });

  it("disables generation and explains missing readiness requirements", async () => {
    const incomplete = candidate();
    incomplete.listing.availableFrom = undefined;
    incomplete.captureSessions = [];
    render(
      <FieldSessionProvider session={{ uid: "admin-1", displayName: "관리자", role: "admin" }}>
        <AdPackageReview
          load={async () => ({ candidates: [incomplete] })}
          create={vi.fn()}
          exclude={vi.fn()}
          mediaAccess={vi.fn(async (id) => ({ url: `https://signed.example/${id}`, expiresAt: NOW }))}
        />
      </FieldSessionProvider>,
    );

    expect(await screen.findByRole("button", { name: "광고 패키지 생성" }))
      .toBeDisabled();
    expect(screen.getByRole("list", { name: "생성할 수 없는 이유" }))
      .toHaveTextContent("입주 가능일");
    expect(screen.getByRole("list", { name: "생성할 수 없는 이유" }))
      .toHaveTextContent("하나의 완료된 촬영 세션");
  });

  it("keeps an in-flight package mutation bound to its listing", async () => {
    const listingA = candidate();
    const listingB = candidate();
    listingB.listing = { ...listingB.listing, id: "listing-2" };
    listingB.building = { ...listingB.building, name: "브링하우스 B" };
    const pending = deferred<CreateAdPackageResult>();
    const create = vi.fn(() => pending.promise);

    render(
      <FieldSessionProvider session={{ uid: "reviewer-1", displayName: "검토자", role: "reviewer" }}>
        <AdPackageReview
          load={async () => ({ candidates: [listingA, listingB] })}
          create={create}
          exclude={vi.fn()}
          mediaAccess={vi.fn(async (id) => ({
            url: `https://signed.example/${id}`,
            expiresAt: "2026-08-10T04:00:00.000Z",
          }))}
          createId={() => REQUEST_ID}
        />
      </FieldSessionProvider>,
    );

    expect(await screen.findByText("브링하우스 · 201호")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "광고 패키지 생성" }));

    const listingBButton = screen.getByRole("button", { name: /브링하우스 B/ });
    expect(listingBButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "생성 요청 중" })).toBeDisabled();
    fireEvent.click(listingBButton);
    expect(screen.queryByText("브링하우스 B · 201호")).not.toBeInTheDocument();

    pending.resolve({
      packageId: "package-1",
      listingId: "listing-1",
      version: 1,
      status: "reviewed",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("1버전 생성 요청 완료");

    fireEvent.click(listingBButton);
    expect(await screen.findByText("브링하우스 B · 201호")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(create).toHaveBeenCalledOnce();
  });

  it("keeps excluded media removed after switching away from and back to a listing", async () => {
    const listingA = candidate();
    const listingB = candidate();
    listingB.listing = { ...listingB.listing, id: "listing-2" };
    listingB.building = { ...listingB.building, name: "브링하우스 B" };
    const exclude = vi.fn(async () => ({
      mediaId: "media-optional",
      excludedAt: NOW,
      excludedBy: "reviewer-1",
    }));

    render(
      <FieldSessionProvider session={{ uid: "reviewer-1", displayName: "검토자", role: "reviewer" }}>
        <AdPackageReview
          load={async () => ({ candidates: [listingA, listingB] })}
          create={vi.fn()}
          exclude={exclude}
          mediaAccess={vi.fn(async (id) => ({
            url: `https://signed.example/${id}`,
            expiresAt: "2026-08-10T06:00:00.000Z",
          }))}
          confirmExclude={() => true}
          createId={() => REQUEST_ID}
        />
      </FieldSessionProvider>,
    );

    expect(await screen.findByText("브링하우스 · 201호")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "media-optional 제외" }));
    await waitFor(() => expect(exclude).toHaveBeenCalledOnce());
    expect(screen.queryByLabelText("광고 포함 media-optional")).not.toBeInTheDocument();
    expect(screen.getByText("10/10개 선택")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /브링하우스 B/ }));
    expect(await screen.findByText("브링하우스 B · 201호")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^브링하우스201호$/ }));

    expect(await screen.findByText("브링하우스 · 201호")).toBeInTheDocument();
    expect(screen.queryByLabelText("광고 포함 media-optional")).not.toBeInTheDocument();
    expect(screen.getByText("10/10개 선택")).toBeInTheDocument();
  });

  it("appends a deduplicated page without changing the selected listing or its review state", async () => {
    const listingA = candidateWithId("listing-1", "브링하우스 A");
    const listingC = candidateWithId("listing-3", "브링하우스 C");
    const load = vi.fn(async ({ cursor }: { cursor?: string }): Promise<AdPackageReviewWorkspacePage> => (
      cursor === undefined
        ? { candidates: [listingA], nextCursor: "listing-050" }
        : { candidates: [candidateWithId("listing-1", "중복 데이터"), listingC] }
    ));
    const exclude = vi.fn(async () => ({
      mediaId: "media-optional",
      excludedAt: NOW,
      excludedBy: "reviewer-1",
    }));

    render(
      <FieldSessionProvider session={{ uid: "reviewer-1", displayName: "검토자", role: "reviewer" }}>
        <AdPackageReview
          load={load}
          create={vi.fn()}
          exclude={exclude}
          mediaAccess={vi.fn(async (id) => ({
            url: `https://signed.example/${id}`,
            expiresAt: "2026-08-10T06:00:00.000Z",
          }))}
          confirmExclude={() => true}
          createId={() => REQUEST_ID}
        />
      </FieldSessionProvider>,
    );

    expect(await screen.findByText("브링하우스 A · 201호")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "media-1 아래로 이동" }));
    fireEvent.click(screen.getByRole("button", { name: "media-optional 제외" }));
    await waitFor(() => expect(exclude).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));

    expect(await screen.findByRole("button", { name: /브링하우스 C/ })).toBeInTheDocument();
    expect(load).toHaveBeenNthCalledWith(1, {});
    expect(load).toHaveBeenNthCalledWith(2, { cursor: "listing-050" });
    expect(screen.getByText("브링하우스 A · 201호")).toBeInTheDocument();
    expect(screen.queryByText("중복 데이터 · 201호")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("광고 포함 media-optional")).not.toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "대표사진 순서" }))
      .getAllByRole("listitem")[0]).toHaveTextContent("media-2");
    expect(screen.getByText("2개 후보")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "더 보기" })).not.toBeInTheDocument();
  });

  it("can continue from an empty page that still has a next cursor", async () => {
    const load = vi.fn(async ({ cursor }: { cursor?: string }): Promise<AdPackageReviewWorkspacePage> => (
      cursor === undefined
        ? { candidates: [], nextCursor: "listing-050" }
        : { candidates: [candidateWithId("listing-51", "다음 후보")] }
    ));

    render(
      <FieldSessionProvider session={{ uid: "reviewer-1", displayName: "검토자", role: "reviewer" }}>
        <AdPackageReview
          load={load}
          create={vi.fn()}
          exclude={vi.fn()}
          mediaAccess={vi.fn(async (id) => ({
            url: `https://signed.example/${id}`,
            expiresAt: "2026-08-10T06:00:00.000Z",
          }))}
        />
      </FieldSessionProvider>,
    );

    expect(await screen.findByText("현재 검토할 수 있는 광고 후보가 없습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
    expect(await screen.findByText("다음 후보 · 201호")).toBeInTheDocument();
  });

  it("blocks duplicate page loads and exposes an error retry", async () => {
    const pending = deferred<AdPackageReviewWorkspacePage>();
    let pageAttempts = 0;
    const load = vi.fn(({ cursor }: { cursor?: string }): Promise<AdPackageReviewWorkspacePage> => {
      if (cursor === undefined) {
        return Promise.resolve({ candidates: [candidate()], nextCursor: "listing-050" });
      }
      pageAttempts += 1;
      return pageAttempts === 1
        ? pending.promise
        : Promise.resolve({ candidates: [candidateWithId("listing-2", "브링하우스 B")] });
    });

    render(
      <FieldSessionProvider session={{ uid: "reviewer-1", displayName: "검토자", role: "reviewer" }}>
        <AdPackageReview
          load={load}
          create={vi.fn()}
          exclude={vi.fn()}
          mediaAccess={vi.fn(async (id) => ({
            url: `https://signed.example/${id}`,
            expiresAt: "2026-08-10T06:00:00.000Z",
          }))}
        />
      </FieldSessionProvider>,
    );

    const more = await screen.findByRole("button", { name: "더 보기" });
    fireEvent.click(more);
    const loading = screen.getByRole("button", { name: "불러오는 중" });
    expect(loading).toBeDisabled();
    fireEvent.click(loading);
    expect(load).toHaveBeenCalledTimes(2);

    await act(async () => pending.reject(new Error("network")));
    expect(await screen.findByRole("alert")).toHaveTextContent("후보를 더 불러오지 못했습니다");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByRole("button", { name: /브링하우스 B/ })).toBeInTheDocument();
    expect(load).toHaveBeenNthCalledWith(3, { cursor: "listing-050" });
  });

  it("ignores a stale next-page response after the loader changes", async () => {
    const stalePage = deferred<AdPackageReviewWorkspacePage>();
    const loadA = vi.fn(({ cursor }: { cursor?: string }) => cursor === undefined
      ? Promise.resolve({ candidates: [candidateWithId("listing-1", "이전 후보")], nextCursor: "listing-050" })
      : stalePage.promise);
    const loadB = vi.fn(async () => ({
      candidates: [candidateWithId("listing-2", "새 후보")],
    }));
    const session = { uid: "reviewer-1", displayName: "검토자", role: "reviewer" as const };
    const commonProps = {
      create: vi.fn(),
      exclude: vi.fn(),
      mediaAccess: vi.fn(async (id: string) => ({
        url: `https://signed.example/${id}`,
        expiresAt: "2026-08-10T06:00:00.000Z",
      })),
    };
    const { rerender } = render(
      <FieldSessionProvider session={session}>
        <AdPackageReview load={loadA} {...commonProps} />
      </FieldSessionProvider>,
    );

    expect(await screen.findByText("이전 후보 · 201호")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
    rerender(
      <FieldSessionProvider session={session}>
        <AdPackageReview load={loadB} {...commonProps} />
      </FieldSessionProvider>,
    );
    expect(await screen.findByText("새 후보 · 201호")).toBeInTheDocument();

    await act(async () => stalePage.resolve({
      candidates: [candidateWithId("listing-3", "늦은 후보")],
    }));
    expect(screen.queryByText("늦은 후보 · 201호")).not.toBeInTheDocument();
    expect(screen.getByText("새 후보 · 201호")).toBeInTheDocument();
  });

  it("refreshes signed previews before expiry and renders only the latest URL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T03:00:00.000Z"));
    try {
      const mediaAccess = vi.fn(async (mediaId: string) => {
        const refresh = mediaAccess.mock.calls.filter(([id]) => id === mediaId).length;
        return {
          url: `https://signed.example/${mediaId}?refresh=${refresh}`,
          expiresAt: refresh === 1
            ? "2026-08-10T03:01:30.000Z"
            : "2026-08-10T03:06:00.000Z",
        };
      });

      render(
        <FieldSessionProvider session={{ uid: "reviewer-1", displayName: "검토자", role: "reviewer" }}>
          <AdPackageReview
            load={async () => ({ candidates: [candidate()] })}
            create={vi.fn()}
            exclude={vi.fn()}
            mediaAccess={mediaAccess}
          />
        </FieldSessionProvider>,
      );

      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });
      expect(mediaAccess).toHaveBeenCalledTimes(candidate().media.length);

      await act(async () => {
        vi.advanceTimersByTime(30_001);
        await Promise.resolve();
      });

      expect(mediaAccess).toHaveBeenCalledTimes(candidate().media.length * 2);
      expect(screen.getByAltText("exterior 촬영본 media-1"))
        .toHaveAttribute("src", "https://signed.example/media-1?refresh=2");
    } finally {
      vi.useRealTimers();
    }
  });
});
