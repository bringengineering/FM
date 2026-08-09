import { StrictMode, useState } from "react";
import { renderToString } from "react-dom/server";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AppShell from "../../app/field/components/AppShell";
import AuthGate from "../../app/field/components/AuthGate";
import {
  FieldSessionProvider,
  useFieldSession,
} from "../../app/field/components/FieldSessionContext";
import FieldMapPanel from "../../app/field/components/FieldMapPanel";
import BuildingWizard from "../../app/field/components/BuildingWizard";
import Dashboard from "../../app/field/components/Dashboard";
import {
  FieldWorkspace,
  saveAndBindCaptureRegistration,
} from "../../app/field/FieldApp";
import OwnerNotesPanel, {
  type OwnerNotesPanelProps,
} from "../../app/field/components/OwnerNotesPanel";
import ManagementContractQueue, {
  createApprovalRequestId,
} from "../../app/field/components/ManagementContractQueue";
import type { FieldSession } from "../../app/field/lib/auth.client";
import type {
  OfflineQueuePort,
  QueuedMediaRecord,
} from "../../app/field/lib/offline-queue";
import {
  REGISTRATION_DRAFT_VERSION,
  activeWizardDraftKey,
  type SaveFieldRegistrationInput,
  wizardDraftStorageKey,
} from "../../app/field/lib/registration-draft";
import type { Building, OwnerNote, OwnerNoteDraft } from "../../app/field/lib/types";

const staffSession = {
  uid: "staff-1",
  displayName: "BRING staff",
  role: "staff" as const,
};

function SessionProbe() {
  const session = useFieldSession();
  const [mountedFor] = useState(session.uid);

  return (
    <div>
      <span>session:{session.uid}</span>
      <span>mounted-for:{mountedFor}</span>
    </div>
  );
}

const pendingBuilding: Building = {
  id: "building-1",
  managementNumber: "BR-0001",
  name: "테스트 빌딩",
  roadAddress: "강원특별자치도 원주시 서원대로 1",
  latitude: 37.3422,
  longitude: 127.9202,
  parking: { available: true, totalSpaces: 8 },
  managementContract: {
    status: "pending",
    startedOn: "2026-08-08",
    updatedAt: "2026-08-08T00:00:00.000Z",
    updatedBy: "staff-1",
  },
  assignedStaffIds: ["staff-1"],
  createdAt: "2026-08-08T00:00:00.000Z",
  createdBy: "staff-1",
  updatedAt: "2026-08-08T00:00:00.000Z",
  updatedBy: "staff-1",
};

describe("FieldMapPanel", () => {
  it("embeds the real BRING Wonju map instead of a placeholder", () => {
    render(<FieldMapPanel />);

    const map = screen.getByTitle("BRING 원주 건물 유지보수 지도");
    expect(map).toHaveAttribute("src", "/wonju-map.html?embedded=field&mode=managed");
    expect(screen.getByRole("link", { name: "전체 화면으로 열기" }))
      .toHaveAttribute("href", "/wonju-map.html?mode=managed");
    expect(screen.queryByText("기능을 연결하고 있습니다")).not.toBeInTheDocument();
  });
});

describe("Dashboard", () => {
  it("shows status cards and mobile-friendly assignments", () => {
    render(<Dashboard onNavigate={vi.fn()} />);
    expect(screen.getByRole("region", { name: "업무 현황" })).toBeInTheDocument();
    expect(screen.getByText("오늘의 현장 업무")).toBeInTheDocument();
    expect(screen.getByText("담당 구역")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "새 건물·매물 등록" })).toBeInTheDocument();
  });
});

describe("ManagementContractQueue", () => {
  it("creates unique RFC 4122 UUID v4 values with secure fallback bytes", () => {
    let call = 0;
    const secureFallback = {
      getRandomValues(values: Uint8Array) {
        call += 1;
        values.forEach((_value, index) => {
          values[index] = (call * 17 + index) & 0xff;
        });
        return values;
      },
    };

    const first = createApprovalRequestId(secureFallback);
    const second = createApprovalRequestId(secureFallback);
    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    expect(first).toMatch(uuidV4);
    expect(second).toMatch(uuidV4);
    expect(second).not.toBe(first);
  });

  it("fails safely when secure UUID generation is unavailable", async () => {
    const approve = vi.fn();
    vi.stubGlobal("crypto", {});

    try {
      expect(() => createApprovalRequestId({})).toThrow("field_secure_random_unavailable");
      render(
        <ManagementContractQueue
          resolveRole={async () => "admin"}
          subscribe={(listener) => {
            listener([pendingBuilding]);
            return () => undefined;
          }}
          approve={approve}
        />,
      );

      fireEvent.click(await screen.findByRole("button", { name: "관리 중으로 승인" }));

      expect(await screen.findByText("승인 실패 · 다시 시도해 주세요"))
        .toBeInTheDocument();
      expect(screen.getByText("테스트 빌딩")).toBeInTheDocument();
      expect(approve).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lets an admin approve a pending building with an editable start date", async () => {
    const approve = vi.fn(async () => ({
      buildingId: "building-1",
      status: "active" as const,
    }));
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((listener: (buildings: Building[]) => void) => {
      listener([pendingBuilding]);
      return unsubscribe;
    });

    render(
      <ManagementContractQueue
        resolveRole={async () => "admin"}
        subscribe={subscribe}
        approve={approve}
      />,
    );

    expect(await screen.findByRole("region", { name: "관리계약 승인 대기" }))
      .toBeInTheDocument();
    expect(screen.getByText("테스트 빌딩")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("테스트 빌딩 관리 시작일"), {
      target: { value: "2026-08-09" },
    });
    fireEvent.click(screen.getByRole("button", { name: "관리 중으로 승인" }));

    await waitFor(() => {
      expect(approve).toHaveBeenCalledWith({
        requestId: expect.any(String),
        buildingId: "building-1",
        status: "active",
        startedOn: "2026-08-09",
      });
    });
    await waitFor(() => expect(screen.queryByText("테스트 빌딩")).not.toBeInTheDocument());
  });

  it("does not render the approval region for staff", async () => {
    render(
      <ManagementContractQueue
        resolveRole={async () => "staff"}
        subscribe={vi.fn()}
        approve={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "관리계약 승인 대기" }))
        .not.toBeInTheDocument();
    });
  });

  it("keeps a failed approval visible and allows retry", async () => {
    const approve = vi.fn(async () => {
      throw new Error("network unavailable");
    });
    render(
      <ManagementContractQueue
        resolveRole={async () => "admin"}
        subscribe={(listener) => {
          listener([pendingBuilding]);
          return () => undefined;
        }}
        approve={approve}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "관리 중으로 승인" }));

    expect(await screen.findByText("승인 실패 · 다시 시도해 주세요")).toBeInTheDocument();
    expect(screen.getByText("테스트 빌딩")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "관리 중으로 승인" })).toBeEnabled();
  });

  it("reuses the same request id when a response is lost and the row is retried", async () => {
    const approve = vi.fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ buildingId: "building-1", status: "active" as const });
    render(
      <ManagementContractQueue
        resolveRole={async () => "admin"}
        subscribe={(listener) => {
          listener([pendingBuilding]);
          return () => undefined;
        }}
        approve={approve}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "관리 중으로 승인" }));
    expect(await screen.findByText("승인 실패 · 다시 시도해 주세요")).toBeInTheDocument();
    const firstRequestId = approve.mock.calls[0][0].requestId;

    fireEvent.click(screen.getByRole("button", { name: "관리 중으로 승인" }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(2));

    expect(approve.mock.calls[1][0].requestId).toBe(firstRequestId);
    await waitFor(() => expect(screen.queryByText("테스트 빌딩")).not.toBeInTheDocument());
  });

  it("creates a new request id when the start date changes after a failed attempt", async () => {
    const approve = vi.fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ buildingId: "building-1", status: "active" as const });
    render(
      <ManagementContractQueue
        resolveRole={async () => "admin"}
        subscribe={(listener) => {
          listener([pendingBuilding]);
          return () => undefined;
        }}
        approve={approve}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "관리 중으로 승인" }));
    expect(await screen.findByText("승인 실패 · 다시 시도해 주세요")).toBeInTheDocument();
    const firstAttempt = approve.mock.calls[0][0];

    fireEvent.change(screen.getByLabelText("테스트 빌딩 관리 시작일"), {
      target: { value: "2026-08-09" },
    });
    fireEvent.click(screen.getByRole("button", { name: "관리 중으로 승인" }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(2));

    const secondAttempt = approve.mock.calls[1][0];
    expect(firstAttempt.startedOn).toBe("2026-08-08");
    expect(secondAttempt.startedOn).toBe("2026-08-09");
    expect(secondAttempt.requestId).not.toBe(firstAttempt.requestId);
    expect(secondAttempt.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("allows only one approval call across two immediate clicks", async () => {
    let resolveApproval: ((result: { buildingId: string; status: "active" }) => void) | undefined;
    const approve = vi.fn(() => new Promise<{ buildingId: string; status: "active" }>((resolve) => {
      resolveApproval = resolve;
    }));
    render(
      <ManagementContractQueue
        resolveRole={async () => "admin"}
        subscribe={(listener) => {
          listener([pendingBuilding]);
          return () => undefined;
        }}
        approve={approve}
      />,
    );

    const approveButton = await screen.findByRole("button", { name: "관리 중으로 승인" });
    fireEvent.click(approveButton);
    fireEvent.click(approveButton);

    expect(approve).toHaveBeenCalledOnce();
    resolveApproval?.({ buildingId: "building-1", status: "active" });
    await waitFor(() => expect(screen.queryByText("테스트 빌딩")).not.toBeInTheDocument());
  });

  it("removes a row when the live pending query omits it", async () => {
    let emit: ((buildings: Building[]) => void) | undefined;
    render(
      <ManagementContractQueue
        resolveRole={async () => "admin"}
        subscribe={(listener) => {
          emit = listener;
          listener([pendingBuilding]);
          return () => undefined;
        }}
        approve={vi.fn()}
      />,
    );

    expect(await screen.findByText("테스트 빌딩")).toBeInTheDocument();
    emit?.([]);
    await waitFor(() => expect(screen.queryByText("테스트 빌딩")).not.toBeInTheDocument());
  });
});

const ownerNoteDraft: OwnerNoteDraft = {
  localId: "local-note-1",
  draftId: "draft-owner-notes",
  body: "공실 방문 전 건물주께 연락",
  recordedAt: "2026-08-10T00:00:00.000Z",
};

function ownerServerNote(overrides: Partial<OwnerNote> = {}): OwnerNote {
  return {
    id: "server-note-1",
    buildingId: "building-1",
    body: "서버 전달사항",
    recordedAt: "2026-08-10T01:00:00.000Z",
    createdAt: "2026-08-10T01:00:01.000Z",
    createdBy: "staff-1",
    createdByName: "BRING staff",
    ...overrides,
  };
}

function OwnerNotesHarness({
  initialDraftNotes = [],
  onDraftChange,
  ...props
}: Omit<OwnerNotesPanelProps, "draftNotes" | "onDraftNotesChange"> & {
  initialDraftNotes?: OwnerNoteDraft[];
  onDraftChange?: (notes: OwnerNoteDraft[]) => void;
}) {
  const [draftNotes, setDraftNotes] = useState(initialDraftNotes);

  return (
    <OwnerNotesPanel
      {...props}
      draftNotes={draftNotes}
      onDraftNotesChange={(notes) => {
        setDraftNotes(notes);
        onDraftChange?.(notes);
      }}
    />
  );
}

describe("OwnerNotesPanel", () => {
  it("keeps a collapsed owner summary visible and focuses the 16px editor only when expanded", async () => {
    const onDraftChange = vi.fn();
    render(
      <OwnerNotesHarness
        draftId="draft-owner-notes"
        currentUser={staffSession}
        initialDraftNotes={[ownerNoteDraft]}
        onDraftChange={onDraftChange}
        createId={() => "local-note-2"}
        now={() => "2026-08-10T02:00:00.000Z"}
      />,
    );

    const panel = screen.getByRole("complementary", { name: "건물주 전달사항" });
    expect(panel).toHaveTextContent("공실 방문 전 건물주께 연락");
    const toggle = screen.getByRole("button", { name: "메모 추가" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    const editor = screen.getByLabelText("새 건물주 전달사항");
    await waitFor(() => expect(editor).toHaveFocus());
    expect(editor).toHaveAttribute("maxlength", "2000");
    expect(screen.getByText("0 / 2,000")).toBeInTheDocument();

    fireEvent.change(editor, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
    expect(screen.getByText("메모 내용을 입력해 주세요.")).toBeInTheDocument();

    fireEvent.change(editor, { target: { value: "  공동현관 비밀번호 변경  " } });
    fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
    expect(await screen.findByText("기기 저장됨 · 건물 등록 시 서버 전송")).toBeInTheDocument();
    expect(onDraftChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({
        localId: "local-note-2",
        body: "공동현관 비밀번호 변경",
      }),
    ]));
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  });

  it("retries a failed server save with the same local id and only client-owned fields", async () => {
    const appended = ownerServerNote({
      id: "retry-note",
      body: "옥상 출입 전 연락",
      recordedAt: "2026-08-10T02:00:00.000Z",
      createdAt: "2026-08-10T02:00:01.000Z",
    });
    const appendNote = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(appended);

    render(
      <OwnerNotesHarness
        buildingId="building-1"
        draftId="draft-owner-notes"
        currentUser={staffSession}
        createId={() => "retry-note"}
        now={() => "2026-08-10T02:00:00.000Z"}
        appendNote={appendNote}
        subscribeNotes={() => () => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    fireEvent.change(screen.getByLabelText("새 건물주 전달사항"), {
      target: { value: "옥상 출입 전 연락" },
    });
    fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));

    expect(await screen.findByText("서버 저장 대기 · 다시 시도")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("서버 저장 완료")).toBeInTheDocument();
    expect(appendNote).toHaveBeenCalledTimes(2);
    expect(appendNote.mock.calls[0][0]).toEqual({
      buildingId: "building-1",
      localId: "retry-note",
      body: "옥상 출입 전 연락",
      recordedAt: "2026-08-10T02:00:00.000Z",
    });
    expect(appendNote.mock.calls[1][0]).toEqual(appendNote.mock.calls[0][0]);
    expect(screen.getAllByText("옥상 출입 전 연락")).toHaveLength(2);
  });

  it("subscribes to the latest 50, can show all, cleans up, and reports load failures", async () => {
    const unsubscribers = [vi.fn(), vi.fn(), vi.fn()];
    const listeners: Array<(notes: OwnerNote[]) => void> = [];
    const errors: Array<(error: Error) => void> = [];
    const subscribeNotes = vi.fn((
      _buildingId: string,
      listener: (notes: OwnerNote[]) => void,
      onError: (error: Error) => void,
    ) => {
      listeners.push(listener);
      errors.push(onError);
      return unsubscribers[listeners.length - 1];
    });
    const view = render(
      <OwnerNotesHarness
        buildingId="building-1"
        draftId="draft-owner-notes"
        currentUser={staffSession}
        subscribeNotes={subscribeNotes}
      />,
    );

    expect(subscribeNotes).toHaveBeenLastCalledWith(
      "building-1",
      expect.any(Function),
      expect.any(Function),
      { limit: 50 },
    );
    act(() => listeners[0]([ownerServerNote()]));
    expect(await screen.findByText("서버 전달사항")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "전체 메모 보기" }));
    expect(unsubscribers[0]).toHaveBeenCalledOnce();
    expect(subscribeNotes).toHaveBeenLastCalledWith(
      "building-1",
      expect.any(Function),
      expect.any(Function),
      {},
    );

    view.rerender(
      <OwnerNotesHarness
        buildingId="building-2"
        draftId="draft-owner-notes"
        currentUser={staffSession}
        subscribeNotes={subscribeNotes}
      />,
    );
    expect(unsubscribers[1]).toHaveBeenCalledOnce();
    expect(screen.queryByText("서버 전달사항")).not.toBeInTheDocument();
    act(() => errors[2](new Error("permission-denied")));
    expect(await screen.findByText(
      "건물주 메모를 불러올 권한이 없거나 네트워크 연결이 끊겼습니다.",
    )).toBeInTheDocument();

    view.unmount();
    expect(unsubscribers[2]).toHaveBeenCalledOnce();
  });

  it("prefers the server copy during merge and exposes archive only to admins", async () => {
    let emit: ((notes: OwnerNote[]) => void) | undefined;
    const archiveNote = vi.fn(async () => ({
      archivedAt: "2026-08-10T03:00:00.000Z",
      archivedBy: "admin-1",
    }));
    const admin = { uid: "admin-1", displayName: "대표", role: "admin" as const };
    render(
      <OwnerNotesHarness
        buildingId="building-1"
        draftId="draft-owner-notes"
        currentUser={admin}
        initialDraftNotes={[ownerNoteDraft]}
        archiveNote={archiveNote}
        subscribeNotes={(_id, listener) => {
          emit = listener;
          return () => undefined;
        }}
      />,
    );

    act(() => emit?.([ownerServerNote({
      id: ownerNoteDraft.localId,
      body: "서버에서 확정된 전달사항",
    })]));
    expect(await screen.findByText("서버에서 확정된 전달사항")).toBeInTheDocument();
    expect(screen.queryByText(ownerNoteDraft.body)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "메모 보관" }));
    await waitFor(() => expect(archiveNote).toHaveBeenCalledWith({
      buildingId: "building-1",
      noteId: ownerNoteDraft.localId,
    }));
    expect(await screen.findByText("메모 보관 완료")).toBeInTheDocument();
  });
});

describe("BuildingWizard", () => {
  it("saves, starts the capture session, binds IDs, then resumes uploads in order", async () => {
    const events: string[] = [];
    const registration = {
      buildingId: "building-1",
      unitIds: { "unit-1": "unit-server-1" },
      listingId: "listing-1",
      visitId: "visit-1",
    };
    const bindRegistration = vi.fn(async () => { events.push("bind"); });
    const resume = vi.fn(async () => { events.push("resume"); });

    await saveAndBindCaptureRegistration({
      input: {} as SaveFieldRegistrationInput,
      capture: {
        captureSessionId: "11111111-1111-4111-8111-111111111111",
        primaryUnitLocalId: "unit-1",
      },
      uid: staffSession.uid,
      requestId: "22222222-2222-4222-8222-222222222222",
      saveRegistration: async () => {
        events.push("save");
        return registration;
      },
      startCaptureSession: async () => {
        events.push("session");
        return { captureSessionId: "11111111-1111-4111-8111-111111111111", visitId: "visit-1" };
      },
      queue: { bindRegistration } as unknown as OfflineQueuePort,
      coordinator: { resume },
    });

    expect(events).toEqual(["save", "session", "bind", "resume"]);
  });

  it("uses the guided camera in step five and persists descriptors without binary data", async () => {
    const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const captureSessionId = "11111111-1111-4111-8111-111111111111";
    const generatedIds = [requestId, captureSessionId];
    const records: QueuedMediaRecord[] = [];
    const queue = {
      putDraft: vi.fn(async () => undefined),
      removeDraft: vi.fn(async () => undefined),
      list: vi.fn(async () => records),
      enqueue: vi.fn(async (input: Parameters<OfflineQueuePort["enqueue"]>[0]) => {
        records.push({
          ...input,
          key: `${input.uid}:${input.mediaId}`,
          retryCount: 0,
          driveSyncState: "notRequested",
        });
      }),
      patch: vi.fn(),
    } as unknown as OfflineQueuePort;
    const draftId = "capture-wizard";

    render(
      <FieldSessionProvider session={staffSession}>
        <BuildingWizard
          session={staffSession}
          draftId={draftId}
          initialStep={4}
          idFactory={() => generatedIds.shift() ?? crypto.randomUUID()}
          queue={queue}
        />
      </FieldSessionProvider>,
    );

    const input = await screen.findByLabelText("외관 사진 촬영");
    fireEvent.change(input, {
      target: {
        files: [new File(["outside"], "outside.jpg", { type: "image/jpeg" })],
      },
    });

    expect(await screen.findByText("기기에 저장됨 · 서버 등록 대기"))
      .toBeInTheDocument();
    await waitFor(() => {
      const stored = window.localStorage.getItem(
        wizardDraftStorageKey(staffSession.uid, draftId),
      );
      expect(stored).toContain("outside.jpg");
      expect(stored).toContain(captureSessionId);
      expect(stored).not.toMatch(/blob:|data:|base64/);
    });
  });

  it("binds and cleans the field visual viewport while mounted", () => {
    const root = document.documentElement;
    root.style.setProperty("--field-visual-viewport-height", "321px");
    const view = render(
      <BuildingWizard session={staffSession} draftId="viewport-binding" />,
    );

    try {
      expect(root.style.getPropertyValue("--field-visual-viewport-height"))
        .not.toBe("321px");
      view.unmount();
      expect(root.style.getPropertyValue("--field-visual-viewport-height"))
        .toBe("321px");
    } finally {
      view.unmount();
      root.style.removeProperty("--field-visual-viewport-height");
      root.removeAttribute("data-field-keyboard-open");
    }
  });

  it("keeps two 등록 단계 이동 slots and validates through the enabled primary action", () => {
    render(<BuildingWizard session={staffSession} draftId="dock-first-step" />);

    const dock = screen.getByRole("group", { name: "등록 단계 이동" });
    expect(within(dock).getAllByRole("button")).toHaveLength(2);
    expect(within(dock).getByRole("button", { name: "이전" })).toBeDisabled();
    const next = within(dock).getByRole("button", { name: "다음 단계" });
    expect(next).toBeEnabled();
    expect(within(dock).queryByRole("button", { name: "입력 확인" }))
      .not.toBeInTheDocument();

    fireEvent.click(next);

    expect(screen.getByText("내부 관리번호를 입력해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "건물 기본정보" })).toBeInTheDocument();
  });

  it("keeps the same two-slot action dock node at a 320px viewport", () => {
    const previousWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });

    try {
      render(
        <BuildingWizard
          session={staffSession}
          draftId="dock-stable-320"
          initialStep={2}
        />,
      );
      const dock = screen.getByRole("group", { name: "등록 단계 이동" });
      expect(within(dock).getAllByRole("button")).toHaveLength(2);

      fireEvent.click(within(dock).getByRole("button", { name: "다음 단계" }));

      expect(screen.getByRole("group", { name: "등록 단계 이동" })).toBe(dock);
      expect(screen.getByRole("group", { name: "옵션·비품" })).toBeInTheDocument();
    } finally {
      if (previousWidth) Object.defineProperty(window, "innerWidth", previousWidth);
    }
  });

  it("keeps the same owner-note panel mounted while wizard steps change", () => {
    render(
      <BuildingWizard
        session={staffSession}
        draftId="persistent-owner-note-panel"
        initialStep={2}
      />,
    );

    const panel = screen.getByRole("complementary", { name: "건물주 전달사항" });
    expect(screen.getAllByRole("complementary", { name: "건물주 전달사항" }))
      .toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    const editor = screen.getByLabelText("새 건물주 전달사항");
    fireEvent.change(editor, { target: { value: "도배 색상 확인" } });

    fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));

    expect(screen.getByRole("complementary", { name: "건물주 전달사항" })).toBe(panel);
    expect(screen.getByLabelText("새 건물주 전달사항")).toBe(editor);
    expect(editor).toHaveValue("도배 색상 확인");
  });

  it("submits owner notes once, then removes only the completed UID draft", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const draftId = "successful-owner-note-registration";
    const scopedKey = wizardDraftStorageKey(staffSession.uid, draftId);
    values.set(activeWizardDraftKey(staffSession.uid), draftId);
    values.set(wizardDraftStorageKey("another-staff", draftId), "keep-me");

    let finish!: (result: {
      buildingId: string;
      unitIds: Record<string, string>;
      listingId: string;
      visitId: string;
    }) => void;
    const pending = new Promise<{
      buildingId: string;
      unitIds: Record<string, string>;
      listingId: string;
      visitId: string;
    }>((resolve) => { finish = resolve; });
    const onComplete = vi.fn((_input: SaveFieldRegistrationInput) => pending);

    render(
      <BuildingWizard
        session={staffSession}
        draftId={draftId}
        initialStep={6}
        storage={storage}
        onComplete={onComplete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    const ownerNoteEditor = screen.getByLabelText("새 건물주 전달사항");
    fireEvent.change(ownerNoteEditor, {
      target: { value: "  방문 전 연락  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
    await waitFor(() => expect(values.get(scopedKey)).toContain("방문 전 연락"));

    const completeButton = screen.getByRole("button", { name: "등록 내용 저장" });
    act(() => {
      fireEvent.click(completeButton);
      fireEvent.click(completeButton);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(ownerNoteEditor).toBeDisabled();
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      draftId,
      ownerNoteDrafts: [expect.objectContaining({ body: "방문 전 연락" })],
    }));
    const submitted = onComplete.mock.calls[0]?.[0];
    expect(submitted?.ownerNoteDrafts?.[0]).not.toHaveProperty("draftId");

    await act(async () => finish({
      buildingId: "building-1",
      unitIds: { "unit-1": "unit-server-1" },
      listingId: "listing-1",
      visitId: "visit-1",
    }));

    expect(await screen.findByText("서버 저장 완료")).toBeInTheDocument();
    expect(values.get(scopedKey)).toBeUndefined();
    expect(values.get(activeWizardDraftKey(staffSession.uid))).toBeUndefined();
    expect(values.get(wizardDraftStorageKey("another-staff", draftId))).toBe("keep-me");
    await waitFor(() => expect(values.get(scopedKey)).toBeUndefined());
  });

  it("retains owner notes and the local draft when server registration fails", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const draftId = "failed-owner-note-registration";
    const scopedKey = wizardDraftStorageKey(staffSession.uid, draftId);

    render(
      <BuildingWizard
        session={staffSession}
        draftId={draftId}
        initialStep={6}
        storage={storage}
        onComplete={vi.fn().mockRejectedValue(new Error("offline"))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    fireEvent.change(screen.getByLabelText("새 건물주 전달사항"), {
      target: { value: "실패해도 남을 메모" },
    });
    fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
    await waitFor(() => expect(values.get(scopedKey)).toContain("실패해도 남을 메모"));
    fireEvent.click(screen.getByRole("button", { name: "등록 내용 저장" }));

    expect(await screen.findByText("서버 저장 실패 · 로컬 초안 유지"))
      .toBeInTheDocument();
    expect(values.get(scopedKey)).toContain("실패해도 남을 메모");
    expect(screen.getAllByText("실패해도 남을 메모").length).toBeGreaterThan(0);
  });

  it("does not report a local cleanup error as a server registration failure", async () => {
    const values = new Map<string, string>();
    const draftId = "cleanup-failure-after-registration";
    const scopedKey = wizardDraftStorageKey(staffSession.uid, draftId);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => {
        if (key === scopedKey) throw new Error("cleanup failed");
        values.delete(key);
      },
    };

    render(
      <BuildingWizard
        session={staffSession}
        draftId={draftId}
        initialStep={6}
        storage={storage}
        onComplete={async () => ({
          buildingId: "building-1",
          unitIds: { "unit-1": "unit-server-1" },
          listingId: "listing-1",
          visitId: "visit-1",
        })}
      />,
    );
    await waitFor(() => expect(values.get(scopedKey)).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "등록 내용 저장" }));

    expect(await screen.findByText("서버 저장 완료 · 로컬 초안 정리 필요"))
      .toBeInTheDocument();
    expect(screen.queryByText("서버 저장 실패 · 로컬 초안 유지"))
      .not.toBeInTheDocument();
    expect(values.get(scopedKey)).toBeDefined();
  });

  it("restores only the active UID's pending owner notes after account switches", async () => {
    const sessionA = { ...staffSession, uid: "owner-note-staff-a", displayName: "직원 A" };
    const sessionB = { ...staffSession, uid: "owner-note-staff-b", displayName: "직원 B" };
    const draftId = "owner-note-switch-draft";
    const view = render(
      <FieldSessionProvider key={sessionA.uid} session={sessionA}>
        <BuildingWizard session={sessionA} draftId={draftId} />
      </FieldSessionProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    fireEvent.change(screen.getByLabelText("새 건물주 전달사항"), {
      target: { value: "A 전용 메모" },
    });
    fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
    await waitFor(() => {
      const stored = window.localStorage.getItem(wizardDraftStorageKey(sessionA.uid, draftId));
      expect(stored).toContain("A 전용 메모");
    });

    view.rerender(
      <FieldSessionProvider key={sessionB.uid} session={sessionB}>
        <BuildingWizard session={sessionB} draftId={draftId} />
      </FieldSessionProvider>,
    );
    expect(screen.queryAllByText("A 전용 메모")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
    fireEvent.change(screen.getByLabelText("새 건물주 전달사항"), {
      target: { value: "B 전용 메모" },
    });
    fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
    await waitFor(() => {
      const stored = window.localStorage.getItem(wizardDraftStorageKey(sessionB.uid, draftId));
      expect(stored).toContain("B 전용 메모");
    });

    view.rerender(
      <FieldSessionProvider key={sessionA.uid} session={sessionA}>
        <BuildingWizard session={sessionA} draftId={draftId} />
      </FieldSessionProvider>,
    );
    expect(screen.getAllByText("A 전용 메모").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("B 전용 메모")).toHaveLength(0);
  });

  it("preserves a future-version draft and blocks completion", async () => {
    const legacyDraftKey = "future-version-draft";
    const stored = JSON.stringify({
      draftVersion: 5,
      draftId: "future-draft",
      requestId: "future-request",
      futureOnlyData: { keep: true },
    });
    const onComplete = vi.fn();
    window.localStorage.setItem(legacyDraftKey, stored);

    render(
      <BuildingWizard
        session={staffSession}
        draftId="future-version"
        legacyDraftKey={legacyDraftKey}
        initialStep={6}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "더 최신 버전에서 작성된 초안이라 현재 화면에서 수정할 수 없습니다.",
    );
    const completeButton = screen.getByRole("button", { name: "등록 내용 저장" });
    expect(completeButton).toBeDisabled();
    fireEvent.click(completeButton);

    await waitFor(() => expect(window.localStorage.getItem(legacyDraftKey)).toBe(stored));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("hides coordinate inputs while preserving the checked address position", async () => {
    render(
      <BuildingWizard
        session={staffSession}
        draftId="hidden-map-position"
        checkAddress={async () => ({
          selection: {
            roadAddress: "강원특별자치도 원주시 서원대로 1",
            latitude: 37.3422,
            longitude: 127.9202,
          },
          existingBuilding: null,
        })}
      />,
    );

    expect(screen.queryByLabelText("위도")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("경도")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("BRING 관리계약 건물"));
    expect(screen.getByLabelText("관리 시작일")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("도로명주소"), {
      target: { value: "강원특별자치도 원주시 서원대로 1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "주소 중복 확인" }));

    expect(await screen.findByText("새 건물로 등록할 수 있는 주소입니다.")).toBeInTheDocument();
    await waitFor(() => {
      const stored = window.localStorage.getItem(
        wizardDraftStorageKey(staffSession.uid, "hidden-map-position"),
      );
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored || "{}").value.building).toMatchObject({
        latitude: 37.3422,
        longitude: 127.9202,
      });
    });
  });

  it("requires an address duplicate check before the building step can continue", async () => {
    const checkAddress = vi.fn(async () => ({
      selection: {
        roadAddress: "강원특별자치도 원주시 서원대로 1",
        jibunAddress: "강원특별자치도 원주시 단계동 1",
        latitude: 37.3422,
        longitude: 127.9202,
      },
      existingBuilding: null,
    }));
    render(
      <BuildingWizard
        session={staffSession}
        draftId="address-check"
        checkAddress={checkAddress}
      />,
    );

    fireEvent.change(screen.getByLabelText("내부 관리번호"), { target: { value: "BR-0001" } });
    fireEvent.change(screen.getByLabelText("건물명"), { target: { value: "테스트 빌딩" } });
    fireEvent.change(screen.getByLabelText("도로명주소"), {
      target: { value: "강원특별자치도 원주시 서원대로 1" },
    });

    const next = screen.getByRole("button", { name: "다음 단계" });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(screen.getByText("주소 확인으로 지도 위치를 설정해 주세요."))
      .toBeInTheDocument();
    expect(screen.getByRole("group", { name: "건물 기본정보" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "주소 중복 확인" }));

    expect(await screen.findByText("새 건물로 등록할 수 있는 주소입니다.")).toBeInTheDocument();
    expect(checkAddress).toHaveBeenCalledWith("강원특별자치도 원주시 서원대로 1");
    fireEvent.click(next);
    expect(screen.getByRole("group", { name: "호실과 임대조건" })).toBeInTheDocument();
  });

  it("blocks creation when the normalized address already exists", async () => {
    render(
      <BuildingWizard
        session={staffSession}
        draftId="duplicate-address"
        checkAddress={async () => ({
          selection: {
            roadAddress: "강원특별자치도 원주시 서원대로 1",
            latitude: 37.3422,
            longitude: 127.9202,
          },
          existingBuilding: { id: "building-1", name: "기존 빌딩" },
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText("도로명주소"), {
      target: { value: "강원특별자치도 원주시 서원대로 1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "주소 중복 확인" }));

    expect(await screen.findByText("기존 빌딩과 주소가 같습니다.")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "다음 단계" });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(screen.getByRole("group", { name: "건물 기본정보" })).toBeInTheDocument();
  });

  it("models multiple units under one building and preserves zero maintenance fee", async () => {
    render(
      <BuildingWizard
        session={staffSession}
        draftId="multiple-units"
        initialStep={1}
        initialDraft={{
          building: {
            managementNumber: "BR-0001",
            name: "테스트 빌딩",
            roadAddress: "강원특별자치도 원주시 서원대로 1",
            latitude: 37.3422,
            longitude: 127.9202,
          },
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("호실 1"), { target: { value: "201호" } });
    fireEvent.change(screen.getByLabelText("관리비(원)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "호실 추가" }));
    fireEvent.change(screen.getByLabelText("호실 2"), { target: { value: "302호" } });

    expect(screen.getByDisplayValue("201호")).toBeInTheDocument();
    expect(screen.getByDisplayValue("302호")).toBeInTheDocument();
    expect(screen.getByLabelText("관리비(원)")).toHaveValue(0);
  });

  it("shows field-level validation errors", () => {
    render(<BuildingWizard session={staffSession} draftId="validation-errors" />);
    fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
    expect(screen.getByText("내부 관리번호를 입력해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("건물명을 입력해 주세요.")).toBeInTheDocument();
    expect(screen.getByLabelText("건물명")).toHaveAttribute("aria-invalid", "true");
  });

  it("claims local autosave completion only after the storage write succeeds", async () => {
    const originalSetItem = Storage.prototype.setItem;
    const statusAtWrite: string[] = [];
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      statusAtWrite.push(
        screen.queryByText("로컬 자동저장 완료") ? "complete" : "pending",
      );
      return originalSetItem.call(this, key, value);
    });

    try {
      render(<BuildingWizard session={staffSession} draftId="autosave-write-order" />);

      expect(statusAtWrite.length).toBeGreaterThan(0);
      expect(statusAtWrite).not.toContain("complete");
      expect(await screen.findByText("로컬 자동저장 완료")).toBeInTheDocument();
    } finally {
      setItem.mockRestore();
    }
  });

  it("reports local autosave failure without claiming completion", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });

    try {
      render(<BuildingWizard session={staffSession} draftId="autosave-write-failure" />);

      expect(screen.queryByText("로컬 자동저장 완료")).not.toBeInTheDocument();
      expect(await screen.findByText("로컬 자동저장 실패")).toBeInTheDocument();
    } finally {
      setItem.mockRestore();
    }
  });

  it("keeps a migrated legacy draft in memory when the scoped write fails", async () => {
    const legacyDraftKey = "legacy-write-failure";
    const values = new Map<string, string>([[legacyDraftKey, JSON.stringify({
      building: { name: "legacy building" },
    })]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key !== legacyDraftKey) throw new Error("quota");
        values.set(key, value);
      },
      removeItem: (key: string) => { values.delete(key); },
    };

    render(
      <BuildingWizard
        session={staffSession}
        draftId="legacy-write-draft"
        legacyDraftKey={legacyDraftKey}
        storage={storage}
      />,
    );

    const name = screen.getByDisplayValue("legacy building");
    fireEvent.change(name, { target: { value: "edited legacy building" } });

    expect(name).toHaveValue("edited legacy building");
    expect(await screen.findByText("로컬 자동저장 실패")).toBeInTheDocument();
    expect(values.get(legacyDraftKey)).toContain("legacy building");
  });

  it("keeps a migrated legacy draft in memory when legacy cleanup fails", async () => {
    const legacyDraftKey = "legacy-cleanup-failure";
    const values = new Map<string, string>([[legacyDraftKey, JSON.stringify({
      building: { name: "cleanup legacy building" },
    })]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => {
        if (key === legacyDraftKey) throw new Error("cleanup failed");
        values.delete(key);
      },
    };

    const view = render(
      <BuildingWizard
        session={staffSession}
        draftId="legacy-cleanup-draft"
        legacyDraftKey={legacyDraftKey}
        storage={storage}
      />,
    );

    const name = screen.getByDisplayValue("cleanup legacy building");
    fireEvent.change(name, { target: { value: "edited cleanup legacy building" } });

    expect(name).toHaveValue("edited cleanup legacy building");
    expect(await screen.findByText("로컬 자동저장 실패")).toBeInTheDocument();
    await waitFor(() => {
      const stored = values.get(
        wizardDraftStorageKey(staffSession.uid, "legacy-cleanup-draft"),
      );
      expect(JSON.parse(stored || "{}").value.building.name)
        .toBe("edited cleanup legacy building");
    });
    expect(values.get(legacyDraftKey)).toContain("cleanup legacy building");

    view.unmount();
    render(
      <BuildingWizard
        session={{ ...staffSession, uid: "staff-b", displayName: "Staff B" }}
        draftId="legacy-cleanup-draft-b"
        legacyDraftKey={legacyDraftKey}
        storage={storage}
      />,
    );
    expect(screen.getByLabelText("건물명")).toHaveValue("");
    expect(screen.queryByDisplayValue("cleanup legacy building")).not.toBeInTheDocument();
  });

  it("leaves an uncommitted render untouched and commits one draft safely in StrictMode", async () => {
    const legacyDraftKey = "legacy-render-boundary";
    const values = new Map<string, string>([[legacyDraftKey, JSON.stringify({
      building: { name: "render boundary building" },
    })]]);
    const mutations: string[] = [];
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mutations.push(`set:${key}`);
        values.set(key, value);
      },
      removeItem: (key: string) => {
        mutations.push(`remove:${key}`);
        values.delete(key);
      },
    };
    const idFactory = () => "strict-mode-draft";

    renderToString(
      <BuildingWizard
        session={staffSession}
        legacyDraftKey={legacyDraftKey}
        storage={storage}
        idFactory={idFactory}
      />,
    );

    expect(mutations).toEqual([]);
    expect(values.get(legacyDraftKey)).toContain("render boundary building");
    expect(values.get(activeWizardDraftKey(staffSession.uid))).toBeUndefined();
    expect(values.get(
      wizardDraftStorageKey(staffSession.uid, "strict-mode-draft"),
    )).toBeUndefined();

    render(
      <StrictMode>
        <BuildingWizard
          session={staffSession}
          legacyDraftKey={legacyDraftKey}
          storage={storage}
          idFactory={idFactory}
        />
      </StrictMode>,
    );

    expect(await screen.findByDisplayValue("render boundary building")).toBeInTheDocument();
    await waitFor(() => {
      expect(values.get(activeWizardDraftKey(staffSession.uid)))
        .toBe("strict-mode-draft");
      expect(values.get(
        wizardDraftStorageKey(staffSession.uid, "strict-mode-draft"),
      )).toBeDefined();
      expect(values.get(legacyDraftKey)).toBeUndefined();
    });
    expect([...values.keys()].filter((key) => key.startsWith(
      `bring-field-wizard:v${REGISTRATION_DRAFT_VERSION}:`,
    )))
      .toEqual([wizardDraftStorageKey(staffSession.uid, "strict-mode-draft")]);
  });

  it("autosaves and restores a draft after remount", async () => {
    const first = render(<BuildingWizard session={staffSession} draftId="restore-draft" />);
    fireEvent.change(screen.getByLabelText("건물명"), { target: { value: "복원 빌딩" } });
    expect(await screen.findByText("로컬 자동저장 완료")).toBeInTheDocument();
    first.unmount();

    render(<BuildingWizard session={staffSession} draftId="restore-draft" />);
    expect(screen.getByLabelText("건물명")).toHaveValue("복원 빌딩");
  });

  it("isolates restored drafts by authenticated UID", async () => {
    const sessionA = { ...staffSession, uid: "staff-a", displayName: "직원 A" };
    const sessionB = { ...staffSession, uid: "staff-b", displayName: "직원 B" };
    const first = render(<BuildingWizard session={sessionA} draftId="shared-route" />);
    fireEvent.change(screen.getByLabelText("건물명"), {
      target: { value: "A private building" },
    });
    await waitFor(() => {
      const stored = window.localStorage.getItem(
        wizardDraftStorageKey(sessionA.uid, "shared-route"),
      );
      expect(JSON.parse(stored || "{}").value.building.name).toBe("A private building");
    });
    first.unmount();

    const second = render(<BuildingWizard session={sessionB} draftId="shared-route" />);
    expect(screen.getByLabelText("건물명")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("건물명"), {
      target: { value: "B private building" },
    });
    await waitFor(() => {
      const stored = window.localStorage.getItem(
        wizardDraftStorageKey(sessionB.uid, "shared-route"),
      );
      expect(JSON.parse(stored || "{}").value.building.name).toBe("B private building");
    });
    second.unmount();

    render(<BuildingWizard session={sessionA} draftId="shared-route" />);
    expect(screen.getByLabelText("건물명")).toHaveValue("A private building");
  });
});

describe("AppShell", () => {
  it("renders the five approved platform destinations", () => {
    render(
      <AppShell active="home" session={staffSession} onLogout={() => undefined}>
        <div>내용</div>
      </AppShell>,
    );

    for (const label of ["홈", "지도", "건물", "촬영", "패키지"]) {
      expect(screen.getAllByRole("button", { name: label }).length).toBeGreaterThan(0);
    }
  });

  it("marks the active destination for assistive technology", () => {
    render(
      <AppShell active="buildings" session={staffSession} onLogout={() => undefined}>
        <div>내용</div>
      </AppShell>,
    );

    for (const button of screen.getAllByRole("button", { name: "건물" })) {
      expect(button).toHaveAttribute("aria-current", "page");
    }
  });

  it("shows the authenticated staff identity and exposes logout", () => {
    const onLogout = vi.fn();
    render(
      <AppShell active="home" session={staffSession} onLogout={onLogout}>
        <div>내용</div>
      </AppShell>,
    );

    expect(screen.getByText(staffSession.displayName)).toBeInTheDocument();
    expect(screen.getByText("내부 직원")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "로그아웃" })[0]);
    expect(onLogout).toHaveBeenCalledOnce();
  });
});

describe("FieldWorkspace capture integration", () => {
  it("opens the real assigned capture workspace instead of a placeholder", async () => {
    const queue = {
      listPending: vi.fn(async () => []),
      list: vi.fn(async () => []),
      countPending: vi.fn(async () => 0),
      close: vi.fn(),
    } as unknown as OfflineQueuePort;
    const stopCoordinator = vi.fn();
    const coordinator = {
      resume: vi.fn(async () => undefined),
      retry: vi.fn(async () => undefined),
      start: vi.fn(() => stopCoordinator),
    };

    const view = render(
      <FieldSessionProvider session={staffSession}>
        <FieldWorkspace
          queueFactory={async () => queue}
          coordinatorFactory={() => coordinator}
          loadCaptureTargets={async () => [{
            id: "managed-building-1",
            buildingId: "building-1",
            buildingName: "브링 관리 건물",
            source: "management",
          }]}
          loadOpenCaptureSessions={async () => []}
        />
      </FieldSessionProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "촬영" })[0]);

    expect(await screen.findByRole("option", { name: "브링 관리 건물" }))
      .toBeInTheDocument();
    expect(coordinator.start).toHaveBeenCalledWith(staffSession.uid);
    expect(screen.queryByText("기능을 연결하고 있습니다")).not.toBeInTheDocument();
    view.unmount();
    expect(stopCoordinator).toHaveBeenCalledOnce();
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it("shows the active UID pending count and cancels logout without stopping uploads", async () => {
    const queue = {
      countPending: vi.fn(async () => 2),
      close: vi.fn(),
    } as unknown as OfflineQueuePort;
    const stopCoordinator = vi.fn();
    const coordinator = {
      resume: vi.fn(async () => undefined),
      retry: vi.fn(async () => undefined),
      start: vi.fn(() => stopCoordinator),
    };
    const confirmExit = vi.fn(() => false);
    const logout = vi.fn(async () => undefined);

    render(
      <FieldSessionProvider session={staffSession}>
        <FieldWorkspace
          queueFactory={async () => queue}
          coordinatorFactory={() => coordinator}
          confirmExit={confirmExit}
          logout={logout}
        />
      </FieldSessionProvider>,
    );

    await waitFor(() => expect(coordinator.start).toHaveBeenCalledWith(staffSession.uid));
    fireEvent.click(screen.getAllByRole("button", { name: "로그아웃" })[0]);

    await waitFor(() => {
      expect(queue.countPending).toHaveBeenCalledWith(staffSession.uid);
      expect(confirmExit).toHaveBeenCalledWith(
        "서버 등록 대기 파일이 2개 있습니다. 로그아웃하면 이 계정으로 다시 로그인할 때까지 업로드가 멈춥니다. 로그아웃할까요?",
      );
    });
    expect(logout).not.toHaveBeenCalled();
    expect(stopCoordinator).not.toHaveBeenCalled();
  });

  it("stops the coordinator before confirmed logout", async () => {
    const calls: string[] = [];
    const queue = {
      countPending: vi.fn(async () => 1),
      close: vi.fn(),
    } as unknown as OfflineQueuePort;
    const coordinator = {
      resume: vi.fn(async () => undefined),
      retry: vi.fn(async () => undefined),
      start: vi.fn(() => () => calls.push("stop")),
    };
    const logout = vi.fn(async () => {
      calls.push("logout");
    });

    render(
      <FieldSessionProvider session={staffSession}>
        <FieldWorkspace
          queueFactory={async () => queue}
          coordinatorFactory={() => coordinator}
          confirmExit={() => true}
          logout={logout}
        />
      </FieldSessionProvider>,
    );

    await waitFor(() => expect(coordinator.start).toHaveBeenCalledWith(staffSession.uid));
    fireEvent.click(screen.getAllByRole("button", { name: "로그아웃" })[0]);

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(calls).toEqual(["stop", "logout"]);
  });
});

describe("AuthGate", () => {
  it("provides the active session and remounts descendants when the uid changes", async () => {
    let emitSession: ((session: FieldSession | null) => void) | undefined;

    render(
      <AuthGate
        observeSession={(listener) => {
          emitSession = listener;
          return () => undefined;
        }}
      >
        <SessionProbe />
      </AuthGate>,
    );

    await waitFor(() => expect(emitSession).toBeDefined());
    act(() => {
      emitSession?.({ uid: "staff-a", displayName: "Staff A", role: "staff" });
    });

    expect(await screen.findByText("session:staff-a")).toBeInTheDocument();
    expect(screen.getByText("mounted-for:staff-a")).toBeInTheDocument();

    act(() => {
      emitSession?.({ uid: "admin-b", displayName: "Admin B", role: "admin" });
    });

    expect(await screen.findByText("session:admin-b")).toBeInTheDocument();
    expect(screen.queryByText("session:staff-a")).not.toBeInTheDocument();
    expect(screen.queryByText("mounted-for:staff-a")).not.toBeInTheDocument();
    expect(screen.getByText("mounted-for:admin-b")).toBeInTheDocument();
  });

  it("shows only the internal Google login before authentication", async () => {
    render(
      <AuthGate
        observeSession={(listener) => {
          listener(null);
          return () => undefined;
        }}
      >
        <div>내부 대시보드</div>
      </AuthGate>,
    );

    expect(await screen.findByRole("button", { name: "Google로 로그인" })).toBeInTheDocument();
    expect(screen.queryByText("내부 대시보드")).not.toBeInTheDocument();
  });

  it("opens the platform after an approved field session is returned", async () => {
    const login = vi.fn(async () => ({
      uid: "user-1",
      displayName: "브링 담당자",
      role: "staff" as const,
    }));

    render(
      <AuthGate
        login={login}
        observeSession={(listener) => {
          listener(null);
          return () => undefined;
        }}
      >
        <div>내부 대시보드</div>
      </AuthGate>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Google로 로그인" }));

    expect(await screen.findByText("내부 대시보드")).toBeInTheDocument();
    expect(login).toHaveBeenCalledOnce();
  });
});
