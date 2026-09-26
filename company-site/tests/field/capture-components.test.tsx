import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CaptureGuide, {
  type CaptureContext,
} from "../../app/field/components/CaptureGuide";
import { FieldSessionProvider } from "../../app/field/components/FieldSessionContext";
import { CAPTURE_ZONES } from "../../app/field/lib/capture-policy";
import type {
  OfflineQueuePort,
  QueuedMediaRecord,
} from "../../app/field/lib/offline-queue";
import type { CaptureAttachmentDescriptor } from "../../app/field/lib/types";

const SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SESSION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MEDIA_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQUEST_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = "2026-08-09T00:00:00.000Z";

const staffOne = {
  uid: "staff-1",
  displayName: "BRING 직원 1",
  role: "staff" as const,
};
const staffTwo = {
  uid: "staff-2",
  displayName: "BRING 직원 2",
  role: "staff" as const,
};

const draftContext: CaptureContext = {
  mode: "draft",
  draftId: "draft-1",
  captureSessionId: SESSION_ID,
  unitLocalId: "unit-local-1",
};
const visitContext: CaptureContext = {
  mode: "visit",
  captureSessionId: SESSION_ID,
  buildingId: "building-1",
  unitId: "unit-1",
  listingId: "listing-1",
  visitId: "visit-1",
};

function photoDescriptor(
  overrides: Partial<CaptureAttachmentDescriptor> = {},
): CaptureAttachmentDescriptor {
  return {
    mediaId: MEDIA_ID,
    captureSessionId: SESSION_ID,
    kind: "photo",
    zone: "exterior",
    slotId: "exterior-1",
    required: true,
    originalFileName: "outside.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 5,
    lastModified: 1,
    capturedAt: NOW,
    uploadState: "queued",
    uploadProgress: 0,
    ...overrides,
  };
}

function queuedRecord(
  overrides: Partial<QueuedMediaRecord> = {},
): QueuedMediaRecord {
  const descriptor = overrides.descriptor ?? photoDescriptor();
  const uid = overrides.uid ?? "staff-1";
  return {
    key: `${uid}:${descriptor.mediaId}`,
    uid,
    mediaId: descriptor.mediaId,
    requestId: REQUEST_ID,
    captureSessionId: descriptor.captureSessionId,
    descriptor,
    binding: { draftId: "draft-1", unitLocalId: "unit-local-1" },
    blob: new Blob(["photo"], { type: descriptor.mimeType }),
    driveSyncState: "notRequested",
    retryCount: 0,
    ...overrides,
  };
}

type TestQueue = OfflineQueuePort & {
  records: QueuedMediaRecord[];
};

function createQueue(initial: QueuedMediaRecord[] = []): TestQueue {
  const records = [...initial];
  const queue: TestQueue = {
    records,
    putDraft: vi.fn(async () => undefined),
    getDraft: vi.fn(async () => undefined),
    removeDraft: vi.fn(async () => undefined),
    putSyncState: vi.fn(async () => undefined),
    getSyncState: vi.fn(async () => undefined),
    enqueue: vi.fn(async (item) => {
      records.push({
        ...item,
        key: `${item.uid}:${item.mediaId}`,
        retryCount: 0,
        driveSyncState: "notRequested",
      });
    }),
    get: vi.fn(async (uid, mediaId) => records.find(
      (record) => record.uid === uid && record.mediaId === mediaId,
    )),
    list: vi.fn(async (uid, captureSessionId) => records.filter((record) => (
      record.uid === uid
      && (captureSessionId === undefined
        || record.captureSessionId === captureSessionId)
    ))),
    listPending: vi.fn(async (uid) => records.filter((record) => (
      record.uid === uid && record.descriptor.uploadState !== "finalized"
    ))),
    patch: vi.fn(async (uid, mediaId, patch) => {
      const index = records.findIndex(
        (record) => record.uid === uid && record.mediaId === mediaId,
      );
      if (index < 0) throw new Error("capture_queue_item_missing");
      records[index] = {
        ...records[index],
        ...patch,
        descriptor: patch.descriptor ?? records[index].descriptor,
      };
    }),
    markFinalized: vi.fn(async () => undefined),
    bindRegistration: vi.fn(async () => undefined),
    countPending: vi.fn(async (uid) => records.filter((record) => (
      record.uid === uid && record.descriptor.uploadState !== "finalized"
    )).length),
    deleteCompleted: vi.fn(async () => undefined),
    close: vi.fn(),
  };
  return queue;
}

function renderGuide(
  queue: OfflineQueuePort,
  props: Partial<React.ComponentProps<typeof CaptureGuide>> = {},
) {
  return render(
    <FieldSessionProvider session={staffOne}>
      <CaptureGuide
        context={draftContext}
        queue={queue}
        coordinator={{ resume: vi.fn(async () => undefined), retry: vi.fn(async () => undefined) }}
        {...props}
      />
    </FieldSessionProvider>,
  );
}

describe("CaptureGuide", () => {
  it("renders every policy zone in order with native rear-camera inputs", async () => {
    renderGuide(createQueue());

    expect(await screen.findByLabelText("외관 사진 촬영")).toHaveAttribute(
      "accept",
      "image/*",
    );
    expect(screen.getByLabelText("외관 사진 촬영")).toHaveAttribute(
      "capture",
      "environment",
    );
    expect(screen.getByLabelText("10~20초 세로영상 촬영")).toHaveAttribute(
      "accept",
      "video/*",
    );
    expect(screen.getByLabelText("10~20초 세로영상 촬영")).toHaveAttribute(
      "capture",
      "environment",
    );
    expect(screen.getByLabelText("외관 사진첩에서 추가")).toHaveAttribute(
      "multiple",
    );
    expect(screen.getByLabelText("외관 사진첩에서 추가")).not.toHaveAttribute(
      "capture",
    );
    expect(screen.getByLabelText("10~20초 세로영상 사진첩에서 추가"))
      .not.toHaveAttribute("capture");
    expect(
      screen.getAllByTestId("capture-zone").map((card) =>
        card.getAttribute("data-zone")),
    ).toEqual(CAPTURE_ZONES.map((zone) => zone.id));
  });

  it("adds every selected gallery photo to the existing capture zone", async () => {
    const queue = createQueue([queuedRecord()]);
    renderGuide(queue);
    const gallery = await screen.findByLabelText("외관 사진첩에서 추가");
    const first = new File(["one"], "one.jpg", { type: "image/jpeg" });
    const second = new File(["two"], "two.jpg", { type: "image/jpeg" });

    fireEvent.change(gallery, { target: { files: [first, second] } });

    await waitFor(() => expect(queue.enqueue).toHaveBeenCalledTimes(2));
    expect(vi.mocked(queue.enqueue).mock.calls.map(([item]) => item.blob))
      .toEqual([first, second]);
    expect(queue.records.filter((record) => record.descriptor.zone === "exterior"))
      .toHaveLength(3);
  });

  it("shows local saved status only after enqueue commits and resets the input", async () => {
    let commit: (() => void) | undefined;
    const events: string[] = [];
    const queue = createQueue();
    queue.enqueue = vi.fn(async (item) => {
      events.push("enqueue:start");
      await new Promise<void>((resolve) => {
        commit = resolve;
      });
      queue.records.push({
        ...item,
        key: `${item.uid}:${item.mediaId}`,
        retryCount: 0,
        driveSyncState: "notRequested",
      });
      events.push("enqueue:commit");
    });
    const coordinator = {
      resume: vi.fn(async () => {
        events.push("resume");
      }),
      retry: vi.fn(async () => undefined),
    };
    renderGuide(queue, { coordinator });
    const input = await screen.findByLabelText("외관 사진 촬영") as HTMLInputElement;
    const file = new File(["photo"], "outside.jpg", {
      type: "image/jpeg",
      lastModified: 1,
    });

    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(queue.enqueue).toHaveBeenCalledOnce());
    expect(screen.queryByText("기기에 저장됨 · Drive 업로드 대기")).not.toBeInTheDocument();
    expect(coordinator.resume).not.toHaveBeenCalled();

    await act(async () => commit?.());
    expect(await screen.findByText("기기에 저장됨 · Drive 업로드 대기"))
      .toBeInTheDocument();
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      uid: "staff-1",
      blob: file,
      binding: { draftId: "draft-1", unitLocalId: "unit-local-1" },
    }));
    await waitFor(() => expect(coordinator.resume).toHaveBeenCalledWith("staff-1"));
    expect(events).toEqual(["enqueue:start", "enqueue:commit", "resume"]);
    expect(input.value).toBe("");
    expect(navigator.storage.persist).toHaveBeenCalledOnce();
  });

  it("treats camera cancel as a no-op and blocks enqueue when quota is low", async () => {
    const queue = createQueue();
    renderGuide(queue);
    const input = await screen.findByLabelText("외관 사진 촬영");

    fireEvent.change(input, { target: { files: [] } });
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    vi.mocked(navigator.storage.estimate).mockResolvedValueOnce({
      usage: 9_500_000,
      quota: 10_000_000,
    });
    fireEvent.change(input, {
      target: {
        files: [new File([new Uint8Array(1_000_000)], "large.jpg", {
          type: "image/jpeg",
        })],
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "기기 저장 공간이 부족합니다",
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(navigator.storage.persist).not.toHaveBeenCalled();
  });

  it("waits for video metadata before enqueue and persists only finite measurements", async () => {
    const queue = createQueue();
    const coordinator = {
      resume: vi.fn(async () => undefined),
      retry: vi.fn(async () => undefined),
    };
    renderGuide(queue, { coordinator });
    const input = await screen.findByLabelText("10~20초 세로영상 촬영");
    const file = new File(["video"], "walk.mp4", {
      type: "video/mp4",
      lastModified: 2,
    });

    fireEvent.change(input, { target: { files: [file] } });
    const preview = await screen.findByLabelText("세로영상 미리보기");
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(coordinator.resume).not.toHaveBeenCalled();
    Object.defineProperties(preview, {
      duration: { configurable: true, value: 12 },
      videoWidth: { configurable: true, value: 1080 },
      videoHeight: { configurable: true, value: 1920 },
    });

    fireEvent.loadedMetadata(preview);
    await waitFor(() => expect(queue.enqueue).toHaveBeenCalledOnce());
    expect(vi.mocked(queue.enqueue).mock.calls[0][0].descriptor.videoMetadata)
      .toEqual({ durationSeconds: 12, width: 1080, height: 1920 });
    await waitFor(() => expect(coordinator.resume).toHaveBeenCalledOnce());
  });

  it("revokes a pending video preview when its enqueue finishes after unmount", async () => {
    let commit!: () => void;
    const queue = createQueue();
    queue.enqueue = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        commit = resolve;
      });
    });
    const view = renderGuide(queue);
    await screen.findAllByTestId("capture-zone");
    const videoZone = screen.getAllByTestId("capture-zone").find(
      (zone) => zone.getAttribute("data-zone") === "verticalVideo",
    );
    const input = videoZone?.querySelector("input[type='file']");
    expect(input).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(["video"], "walk.mp4", { type: "video/mp4" })],
      },
    });
    await waitFor(() => {
      expect(videoZone?.querySelector("video")).toBeInstanceOf(HTMLVideoElement);
    });
    const preview = videoZone?.querySelector("video");
    if (!(preview instanceof HTMLVideoElement)) {
      throw new Error("pending_video_preview_missing");
    }
    Object.defineProperties(preview, {
      duration: { configurable: true, value: 12 },
      videoWidth: { configurable: true, value: 1080 },
      videoHeight: { configurable: true, value: 1920 },
    });
    fireEvent.loadedMetadata(preview);
    await waitFor(() => expect(queue.enqueue).toHaveBeenCalledOnce());

    view.unmount();
    await act(async () => commit());

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-1");
  });

  it("queues a video after the five-second metadata timeout and shows a warning", async () => {
    vi.useFakeTimers();
    try {
      const queue = createQueue();
      renderGuide(queue);
      const input = screen.getByLabelText("10~20초 세로영상 촬영");
      fireEvent.change(input, {
        target: {
          files: [new File(["video"], "slow.mp4", { type: "video/mp4" })],
        },
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(queue.enqueue).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(5_000);
        await Promise.resolve();
      });

      expect(queue.enqueue).toHaveBeenCalledOnce();
      expect(vi.mocked(queue.enqueue).mock.calls[0][0].descriptor)
        .not.toHaveProperty("videoMetadata");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "영상 정보를 확인하지 못했습니다",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps invalid vertical video but excludes it from the required count", async () => {
    const videoDescriptor: CaptureAttachmentDescriptor = {
      ...photoDescriptor({
        kind: "video",
        zone: "verticalVideo",
        slotId: "verticalVideo-1",
        originalFileName: "wide.mp4",
        mimeType: "video/mp4",
        videoMetadata: { durationSeconds: 8, width: 1920, height: 1080 },
      }),
    };
    const queue = createQueue([
      queuedRecord({
        descriptor: videoDescriptor,
        mediaId: videoDescriptor.mediaId,
        captureSessionId: videoDescriptor.captureSessionId,
        blob: new Blob(["video"], { type: "video/mp4" }),
      }),
    ]);
    renderGuide(queue);

    expect(await screen.findByText("영상은 10~20초로 촬영해 주세요."))
      .toBeInTheDocument();
    expect(screen.getByText("휴대전화를 세로로 들고 촬영해 주세요."))
      .toBeInTheDocument();
    expect(screen.getByTestId("capture-count-verticalVideo")).toHaveTextContent(
      "0 / 1",
    );
    expect(screen.getByText("필수 촬영 미완료")).toBeInTheDocument();
  });

  it("uses fresh IDs for replacement, excludes the old item, and revokes its preview", async () => {
    const old = queuedRecord();
    const queue = createQueue([old]);
    const onDescriptorsChange = vi.fn();
    renderGuide(queue, { onDescriptorsChange });
    await screen.findByAltText("외관 미리보기");

    fireEvent.click(screen.getByRole("button", { name: "외관 사진 교체" }));
    fireEvent.change(screen.getByLabelText("외관 사진 촬영"), {
      target: {
        files: [new File(["new"], "outside-new.jpg", { type: "image/jpeg" })],
      },
    });

    await waitFor(() => expect(queue.enqueue).toHaveBeenCalledOnce());
    const replacement = vi.mocked(queue.enqueue).mock.calls[0][0];
    expect(replacement.mediaId).not.toBe(MEDIA_ID);
    expect(replacement.requestId).not.toBe(REQUEST_ID);
    expect(replacement.descriptor).not.toHaveProperty("replacesMediaId");
    await waitFor(() => expect(queue.patch).toHaveBeenCalledWith(
      "staff-1",
      MEDIA_ID,
      expect.objectContaining({ lastError: "capture_excluded" }),
    ));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-1");
    await waitFor(() => {
      const latest = onDescriptorsChange.mock.calls.at(-1)?.[0] as
        CaptureAttachmentDescriptor[];
      expect(latest.map((descriptor) => descriptor.mediaId)).not.toContain(MEDIA_ID);
      expect(latest).toEqual(expect.arrayContaining([
        expect.objectContaining({ mediaId: replacement.mediaId }),
      ]));
    });
  });

  it("keeps a finalized predecessor on the server until replacement finalization is atomic", async () => {
    const finalized = queuedRecord({
      descriptor: photoDescriptor({ uploadState: "finalized", uploadProgress: 100 }),
      blob: undefined,
      storagePath: "field-media-finalized/building-1/photo.jpg",
      driveSyncState: "complete",
      binding: {
        buildingId: "building-1",
        unitId: "unit-1",
        listingId: "listing-1",
        visitId: "visit-1",
      },
    });
    const queue = createQueue([finalized]);
    const excludeFieldMedia = vi.fn(async () => undefined);
    renderGuide(queue, {
      context: visitContext,
      excludeFieldMedia,
      getFieldMediaAccess: async () => ({
        url: "https://signed.example/photo",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    });

    await screen.findByAltText("외관 미리보기");
    fireEvent.click(screen.getByRole("button", { name: "외관 사진 교체" }));
    fireEvent.change(screen.getByLabelText("외관 사진 촬영"), {
      target: {
        files: [new File(["new"], "outside-new.jpg", { type: "image/jpeg" })],
      },
    });

    await waitFor(() => expect(queue.enqueue).toHaveBeenCalledOnce());
    expect(vi.mocked(queue.enqueue).mock.calls[0][0].descriptor.replacesMediaId)
      .toBe(MEDIA_ID);
    await waitFor(() => expect(queue.patch).toHaveBeenCalledWith(
      "staff-1",
      MEDIA_ID,
      expect.objectContaining({ lastError: "capture_excluded" }),
    ));
    expect(excludeFieldMedia).not.toHaveBeenCalled();
  });

  it("calls the authorized exclusion requester for finalized media without deleting originals", async () => {
    const finalized = queuedRecord({
      descriptor: photoDescriptor({ uploadState: "finalized", uploadProgress: 100 }),
      blob: undefined,
      storagePath: "field-media-finalized/building-1/photo.jpg",
      driveSyncState: "complete",
    });
    const queue = createQueue([finalized]);
    const excludeFieldMedia = vi.fn(async () => undefined);
    renderGuide(queue, {
      context: visitContext,
      excludeFieldMedia,
      getFieldMediaAccess: async () => ({
        url: "https://signed.example/photo",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    });

    await screen.findByAltText("외관 미리보기");
    fireEvent.click(screen.getByRole("button", { name: "외관 사진 제외" }));

    await waitFor(() => expect(excludeFieldMedia).toHaveBeenCalledWith({
      mediaId: MEDIA_ID,
      requestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    }));
    expect(queue.deleteCompleted).not.toHaveBeenCalled();
  });

  it("drops previews on session, account, and unmount changes", async () => {
    const sessionOnePhoto = queuedRecord();
    const sessionTwoPhoto = queuedRecord({
      descriptor: photoDescriptor({
        mediaId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        captureSessionId: OTHER_SESSION_ID,
      }),
      mediaId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      captureSessionId: OTHER_SESSION_ID,
    });
    const staffTwoPhoto = queuedRecord({
      uid: "staff-2",
      key: "staff-2:ffffffff-ffff-4fff-8fff-ffffffffffff",
      descriptor: photoDescriptor({ mediaId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }),
      mediaId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    });
    const queue = createQueue([sessionOnePhoto, sessionTwoPhoto, staffTwoPhoto]);
    const view = render(
      <FieldSessionProvider session={staffOne}>
        <CaptureGuide context={draftContext} queue={queue} />
      </FieldSessionProvider>,
    );
    await screen.findByAltText("외관 미리보기");

    view.rerender(
      <FieldSessionProvider session={staffOne}>
        <CaptureGuide
          context={{ ...draftContext, captureSessionId: OTHER_SESSION_ID }}
          queue={queue}
        />
      </FieldSessionProvider>,
    );
    await waitFor(() => expect(queue.list).toHaveBeenLastCalledWith(
      "staff-1",
      OTHER_SESSION_ID,
    ));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-1");

    view.rerender(
      <FieldSessionProvider session={staffTwo}>
        <CaptureGuide context={draftContext} queue={queue} />
      </FieldSessionProvider>,
    );
    await waitFor(() => expect(queue.list).toHaveBeenLastCalledWith(
      "staff-2",
      SESSION_ID,
    ));
    view.unmount();
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps finalized access URLs in component memory only and retries failed items", async () => {
    const finalized = queuedRecord({
      descriptor: photoDescriptor({ uploadState: "finalized", uploadProgress: 100 }),
      blob: undefined,
      storagePath: "field-media-finalized/building-1/photo.jpg",
    });
    const failed = queuedRecord({
      descriptor: photoDescriptor({
        mediaId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        zone: "parking",
        slotId: "parking-1",
        required: false,
        uploadState: "failed",
        failureCode: "network_retry",
      }),
      mediaId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      key: "staff-1:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      lastError: "network_retry",
    });
    const queue = createQueue([finalized, failed]);
    const getFieldMediaAccess = vi.fn(async () => ({
      url: "https://signed.example/temporary",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }));
    const coordinator = {
      resume: vi.fn(async () => undefined),
      retry: vi.fn(async () => undefined),
    };
    renderGuide(queue, { getFieldMediaAccess, coordinator });

    expect(await screen.findByAltText("외관 미리보기")).toHaveAttribute(
      "src",
      "https://signed.example/temporary",
    );
    expect(getFieldMediaAccess).toHaveBeenCalledWith(MEDIA_ID);
    expect(JSON.stringify(await queue.get("staff-1", MEDIA_ID)))
      .not.toContain("signed.example");
    fireEvent.click(await screen.findByRole("button", { name: "주차 업로드 다시 시도" }));
    await waitFor(() => expect(coordinator.retry).toHaveBeenCalledWith(
      "staff-1",
      failed.mediaId,
    ));
  });
});
