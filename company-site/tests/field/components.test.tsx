import { StrictMode, useState } from "react";
import { renderToString } from "react-dom/server";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AppShell from "../../app/field/components/AppShell";
import AuthGate from "../../app/field/components/AuthGate";
import { useFieldSession } from "../../app/field/components/FieldSessionContext";
import FieldMapPanel from "../../app/field/components/FieldMapPanel";
import BuildingWizard from "../../app/field/components/BuildingWizard";
import Dashboard from "../../app/field/components/Dashboard";
import OwnerNotesPanel, {
  type OwnerNotesPanelProps,
} from "../../app/field/components/OwnerNotesPanel";
import ManagementContractQueue, {
  createApprovalRequestId,
} from "../../app/field/components/ManagementContractQueue";
import type { FieldSession } from "../../app/field/lib/auth.client";
import {
  activeWizardDraftKey,
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
    const editor = screen.getByLabelText("새 전달사항");
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
    fireEvent.change(screen.getByLabelText("새 전달사항"), {
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
  it("preserves a future-version draft and blocks completion", async () => {
    const legacyDraftKey = "future-version-draft";
    const stored = JSON.stringify({
      draftVersion: 4,
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

    expect(screen.getByRole("button", { name: "다음 단계" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "주소 중복 확인" }));

    expect(await screen.findByText("새 건물로 등록할 수 있는 주소입니다.")).toBeInTheDocument();
    expect(checkAddress).toHaveBeenCalledWith("강원특별자치도 원주시 서원대로 1");
    expect(screen.getByRole("button", { name: "다음 단계" })).toBeEnabled();
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
    expect(screen.getByRole("button", { name: "다음 단계" })).toBeDisabled();
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
    fireEvent.click(screen.getByRole("button", { name: "입력 확인" }));
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
    expect([...values.keys()].filter((key) => key.startsWith("bring-field-wizard:v3:")))
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
      <AppShell active="home">
        <div>내용</div>
      </AppShell>,
    );

    for (const label of ["홈", "지도", "건물", "촬영", "패키지"]) {
      expect(screen.getAllByRole("button", { name: label }).length).toBeGreaterThan(0);
    }
  });

  it("marks the active destination for assistive technology", () => {
    render(
      <AppShell active="buildings">
        <div>내용</div>
      </AppShell>,
    );

    for (const button of screen.getAllByRole("button", { name: "건물" })) {
      expect(button).toHaveAttribute("aria-current", "page");
    }
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
