import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AppShell from "../../app/field/components/AppShell";
import AuthGate from "../../app/field/components/AuthGate";
import FieldMapPanel from "../../app/field/components/FieldMapPanel";
import BuildingWizard from "../../app/field/components/BuildingWizard";
import Dashboard from "../../app/field/components/Dashboard";
import ManagementContractQueue, {
  createApprovalRequestId,
} from "../../app/field/components/ManagementContractQueue";
import type { Building } from "../../app/field/lib/types";

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
    expect(map).toHaveAttribute("src", expect.stringContaining("wonju-map.html"));
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

describe("BuildingWizard", () => {
  it("preserves a future-version draft and blocks completion", async () => {
    const draftKey = "future-version-draft";
    const stored = JSON.stringify({
      draftVersion: 3,
      draftId: "future-draft",
      requestId: "future-request",
      futureOnlyData: { keep: true },
    });
    const onComplete = vi.fn();
    window.localStorage.setItem(draftKey, stored);

    render(
      <BuildingWizard
        draftKey={draftKey}
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

    await waitFor(() => expect(window.localStorage.getItem(draftKey)).toBe(stored));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("hides coordinate inputs while preserving the checked address position", async () => {
    render(
      <BuildingWizard
        draftKey="hidden-map-position"
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
      const stored = window.localStorage.getItem("hidden-map-position");
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored || "{}").building).toMatchObject({
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
    render(<BuildingWizard draftKey="address-check" checkAddress={checkAddress} />);

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
        draftKey="duplicate-address"
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
        draftKey="multiple-units"
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
    render(<BuildingWizard draftKey="validation-errors" />);
    fireEvent.click(screen.getByRole("button", { name: "입력 확인" }));
    expect(screen.getByText("내부 관리번호를 입력해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("건물명을 입력해 주세요.")).toBeInTheDocument();
    expect(screen.getByLabelText("건물명")).toHaveAttribute("aria-invalid", "true");
  });

  it("autosaves and restores a draft after remount", () => {
    const first = render(<BuildingWizard draftKey="restore-draft" />);
    fireEvent.change(screen.getByLabelText("건물명"), { target: { value: "복원 빌딩" } });
    expect(screen.getByText("로컬 자동저장 완료")).toBeInTheDocument();
    first.unmount();

    render(<BuildingWizard draftKey="restore-draft" />);
    expect(screen.getByLabelText("건물명")).toHaveValue("복원 빌딩");
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
