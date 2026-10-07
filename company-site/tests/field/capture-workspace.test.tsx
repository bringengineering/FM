import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CaptureWorkspace, {
  type CaptureTarget,
} from "../../app/field/components/CaptureWorkspace";
import { FieldSessionProvider } from "../../app/field/components/FieldSessionContext";
import type { StartFieldCaptureSessionInput } from "../../app/field/lib/field-api.client";
import type {
  OfflineQueuePort,
  QueuedMediaRecord,
} from "../../app/field/lib/offline-queue";
import type {
  CaptureAttachmentDescriptor,
  CaptureSessionRecord,
} from "../../app/field/lib/types";

const NOW = "2026-08-09T09:00:00.000Z";
const SESSION_OLD = "11111111-1111-4111-8111-111111111111";
const SESSION_NEW = "22222222-2222-4222-8222-222222222222";

const staffOne = {
  uid: "staff-1",
  displayName: "BRING 직원 1",
  role: "staff" as const,
};

const managedTarget: CaptureTarget = {
  id: "managed-b1-u1",
  buildingId: "managed-b1",
  buildingName: "관리 건물",
  unitId: "u1",
  unitLabel: "201호",
  source: "management",
};

const advertisingTarget: CaptureTarget = {
  id: "listing-l2",
  buildingId: "advertising-b2",
  buildingName: "광고 매물",
  unitId: "u2",
  unitLabel: "302호",
  listingId: "listing-l2",
  source: "advertising",
};

function openSession(
  overrides: Partial<CaptureSessionRecord> = {},
): CaptureSessionRecord {
  return {
    id: SESSION_OLD,
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    buildingId: managedTarget.buildingId,
    unitId: managedTarget.unitId,
    visitId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    createdBy: staffOne.uid,
    status: "open",
    createdAt: "2026-08-09T08:00:00.000Z",
    updatedAt: "2026-08-09T08:00:00.000Z",
    ...overrides,
  };
}

function photoDescriptor(
  sessionId: string,
  mediaId: string,
  fileName: string,
  uploadState: CaptureAttachmentDescriptor["uploadState"] = "queued",
): CaptureAttachmentDescriptor {
  return {
    mediaId,
    captureSessionId: sessionId,
    kind: "photo",
    zone: "exterior",
    slotId: `exterior-${mediaId}`,
    required: true,
    originalFileName: fileName,
    mimeType: "image/jpeg",
    sizeBytes: 8,
    lastModified: 1,
    capturedAt: NOW,
    uploadState,
    uploadProgress: uploadState === "failed" ? 25 : 0,
    ...(uploadState === "failed" ? { failureCode: "network_retry" } : {}),
  };
}

function queuedRecord(
  sessionId: string,
  mediaId: string,
  fileName: string,
  overrides: Partial<QueuedMediaRecord> = {},
): QueuedMediaRecord {
  const descriptor = overrides.descriptor
    ?? photoDescriptor(sessionId, mediaId, fileName);
  const uid = overrides.uid ?? staffOne.uid;
  return {
    key: `${uid}:${mediaId}`,
    uid,
    mediaId,
    requestId: `request-${mediaId}`,
    captureSessionId: sessionId,
    descriptor,
    binding: { buildingId: managedTarget.buildingId, visitId: "visit-1" },
    blob: new Blob([fileName], { type: "image/jpeg" }),
    driveSyncState: "notRequested",
    retryCount: uploadStateRetryCount(descriptor.uploadState),
    ...overrides,
  };
}

function uploadStateRetryCount(
  uploadState: CaptureAttachmentDescriptor["uploadState"],
): number {
  return uploadState === "failed" ? 1 : 0;
}

type TestQueue = OfflineQueuePort & { records: QueuedMediaRecord[] };

function createQueue(initial: QueuedMediaRecord[] = []): TestQueue {
  const records = [...initial];
  return {
    records,
    putDraft: vi.fn(async () => undefined),
    getDraft: vi.fn(async () => undefined),
    removeDraft: vi.fn(async () => undefined),
    putSyncState: vi.fn(async () => undefined),
    getSyncState: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => undefined),
    get: vi.fn(async (uid, mediaId) => records.find((record) => (
      record.uid === uid && record.mediaId === mediaId
    ))),
    list: vi.fn(async (uid, captureSessionId) => records.filter((record) => (
      record.uid === uid
      && (captureSessionId === undefined
        || record.captureSessionId === captureSessionId)
    ))),
    listPending: vi.fn(async (uid) => records.filter((record) => (
      record.uid === uid && record.descriptor.uploadState !== "finalized"
    ))),
    patch: vi.fn(async () => undefined),
    markFinalized: vi.fn(async () => undefined),
    bindRegistration: vi.fn(async () => undefined),
    countPending: vi.fn(async (uid) => records.filter((record) => (
      record.uid === uid && record.descriptor.uploadState !== "finalized"
    )).length),
    deleteCompleted: vi.fn(async () => undefined),
    close: vi.fn(),
  };
}

function startResult(input: StartFieldCaptureSessionInput) {
  return Promise.resolve({
    captureSessionId: input.captureSessionId,
    visitId: input.visitId,
  });
}

function renderWorkspace(
  overrides: Partial<React.ComponentProps<typeof CaptureWorkspace>> = {},
) {
  const queue = overrides.queue ?? createQueue();
  const startSession = overrides.startSession ?? vi.fn(startResult);
  const coordinator = overrides.coordinator ?? {
    resume: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  };
  const view = render(
    <FieldSessionProvider session={staffOne}>
      <CaptureWorkspace
        loadTargets={async () => [managedTarget, advertisingTarget]}
        loadOpenSessions={async () => []}
        startSession={startSession}
        queue={queue}
        coordinator={coordinator}
        {...overrides}
      />
    </FieldSessionProvider>,
  );
  return { ...view, coordinator, queue, startSession };
}

describe("CaptureWorkspace", () => {
  it("shows the phone-wide upload totals and today's progress", async () => {
    renderWorkspace({
      uploadSummary: {
        todayTotal: 7,
        uploading: 2,
        completedToday: 4,
        failed: 1,
        progressPercent: 64,
      },
    });

    expect(await screen.findByLabelText("휴대전화 전체 업로드 현황"))
      .toHaveTextContent("오늘 7업로드 중 2완료 4실패 1");
    expect(screen.getByRole("progressbar", { name: "오늘 업로드 진행률" }))
      .toHaveAttribute("aria-valuenow", "64");
  });

  it("keeps managed-building and advertising targets in separate selector groups", async () => {
    renderWorkspace();

    const managedGroup = await screen.findByRole("group", {
      name: "관리 계약 건물",
    });
    const advertisingGroup = screen.getByRole("group", { name: "광고 매물" });
    expect(within(managedGroup).getByRole("option", {
      name: "관리 건물 · 201호",
    })).toBeInTheDocument();
    expect(within(advertisingGroup).getByRole("option", {
      name: "광고 매물 · 302호",
    })).toBeInTheDocument();
    expect(screen.getByText("관리 계약")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("촬영 대상"), {
      target: { value: advertisingTarget.id },
    });
    expect(screen.getByText("광고 매물", { selector: ".field-capture-source-badge" }))
      .toBeInTheDocument();
  });

  it("shows only owned open sessions newest first with pending and retry counts", async () => {
    const newer = openSession({
      id: SESSION_NEW,
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      buildingId: advertisingTarget.buildingId,
      unitId: advertisingTarget.unitId,
      listingId: advertisingTarget.listingId,
      visitId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      createdAt: "2026-08-09T09:00:00.000Z",
      updatedAt: "2026-08-09T09:00:00.000Z",
    });
    const failed = queuedRecord(
      SESSION_NEW,
      "failed-media",
      "failed.jpg",
      { descriptor: photoDescriptor(SESSION_NEW, "failed-media", "failed.jpg", "failed") },
    );
    const queue = createQueue([
      queuedRecord(SESSION_OLD, "old-media", "old.jpg"),
      queuedRecord(SESSION_NEW, "new-media", "new.jpg"),
      failed,
      queuedRecord(SESSION_OLD, "foreign-media", "foreign.jpg", { uid: "staff-2" }),
    ]);

    renderWorkspace({
      queue,
      loadOpenSessions: async () => [
        openSession(),
        newer,
        openSession({ id: "complete", status: "complete" }),
        openSession({ id: "foreign", createdBy: "staff-2" }),
      ],
    });

    const cards = await screen.findAllByTestId("open-capture-session");
    expect(cards.map((card) => card.getAttribute("data-session-id")))
      .toEqual([SESSION_NEW, SESSION_OLD]);
    expect(screen.getByLabelText("휴대전화 전체 업로드 현황")).toBeInTheDocument();
    expect(within(cards[0]).getByText("2개 대기 · 1개 재시도"))
      .toBeInTheDocument();
    expect(queue.listPending).toHaveBeenCalledWith(staffOne.uid);
  });

  it("resumes an owned session unchanged and starts a fresh vacancy visit", async () => {
    const existing = openSession();
    const startSession = vi.fn(startResult);
    renderWorkspace({
      loadOpenSessions: async () => [existing],
      startSession,
    });

    fireEvent.click(await screen.findByRole("button", {
      name: "진행 중 촬영 이어서 하기",
    }));
    expect(await screen.findByLabelText("외관 사진 촬영")).toBeInTheDocument();
    expect(startSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "새 방문 촬영 시작" }));
    await waitFor(() => expect(startSession).toHaveBeenCalledTimes(1));
    expect(startSession).toHaveBeenCalledWith(expect.objectContaining({
      buildingId: managedTarget.buildingId,
      unitId: managedTarget.unitId,
      visitType: "vacancyRefresh",
    }));
    expect(await screen.findByLabelText("외관 사진 촬영")).toBeInTheDocument();
  });

  it("passes protected preview access into the shared capture guide", async () => {
    const existing = openSession();
    const finalized = queuedRecord(SESSION_OLD, "final-photo", "final.jpg", {
      blob: undefined,
      storagePath: "field-media-finalized/building-managed/final-photo.jpg",
      driveSyncState: "queued",
      descriptor: photoDescriptor(
        SESSION_OLD,
        "final-photo",
        "final.jpg",
        "finalized",
      ),
    });
    const queue = createQueue([finalized]);
    const getFieldMediaAccess = vi.fn(async () => ({
      url: "https://signed.example/final-photo",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }));
    renderWorkspace({
      queue,
      loadOpenSessions: async () => [existing],
      getFieldMediaAccess,
    });

    fireEvent.click(await screen.findByRole("button", {
      name: "진행 중 촬영 이어서 하기",
    }));

    await waitFor(() => expect(getFieldMediaAccess).toHaveBeenCalledWith("final-photo"));
  });

  it("reuses the same request, session, and visit IDs when starting is retried", async () => {
    const startSession = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(startResult);
    renderWorkspace({ startSession });

    fireEvent.click(await screen.findByRole("button", {
      name: "새 방문 촬영 시작",
    }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "방문 촬영을 시작하지 못했습니다",
    );
    fireEvent.click(screen.getByRole("button", { name: "같은 정보로 다시 시도" }));

    await waitFor(() => expect(startSession).toHaveBeenCalledTimes(2));
    expect(startSession.mock.calls[1][0]).toEqual(startSession.mock.calls[0][0]);
    expect(await screen.findByLabelText("외관 사진 촬영")).toBeInTheDocument();
  });

  it("cleans old previews and scopes queue reads when switching sessions", async () => {
    const queue = createQueue([
      queuedRecord(SESSION_OLD, "old-photo", "old-session.jpg"),
      queuedRecord(SESSION_NEW, "new-photo", "new-session.jpg", {
        binding: {
          buildingId: advertisingTarget.buildingId,
          unitId: advertisingTarget.unitId,
          listingId: advertisingTarget.listingId,
          visitId: "visit-new",
        },
      }),
      queuedRecord(SESSION_NEW, "foreign-photo", "foreign-session.jpg", {
        uid: "staff-2",
      }),
    ]);
    const newer = openSession({
      id: SESSION_NEW,
      buildingId: advertisingTarget.buildingId,
      unitId: advertisingTarget.unitId,
      listingId: advertisingTarget.listingId,
      visitId: "visit-new",
      createdAt: "2026-08-09T09:00:00.000Z",
      updatedAt: "2026-08-09T09:00:00.000Z",
    });
    renderWorkspace({ queue, loadOpenSessions: async () => [openSession(), newer] });

    const oldCard = await screen.findByTestId(`open-session-${SESSION_OLD}`);
    fireEvent.click(within(oldCard).getByRole("button", {
      name: "진행 중 촬영 이어서 하기",
    }));
    expect(await screen.findByText("old-session.jpg")).toBeInTheDocument();

    const newCard = screen.getByTestId(`open-session-${SESSION_NEW}`);
    fireEvent.click(within(newCard).getByRole("button", {
      name: "진행 중 촬영 이어서 하기",
    }));
    expect(await screen.findByText("new-session.jpg")).toBeInTheDocument();
    expect(screen.queryByText("old-session.jpg")).not.toBeInTheDocument();
    expect(screen.queryByText("foreign-session.jpg")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-1");
    expect(queue.list).toHaveBeenCalledWith(staffOne.uid, SESSION_NEW);
  });
});
