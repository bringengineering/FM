import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AppShell from "../../app/field/components/AppShell";
import AuthGate from "../../app/field/components/AuthGate";
import FieldMapPanel from "../../app/field/components/FieldMapPanel";
import BuildingWizard from "../../app/field/components/BuildingWizard";
import Dashboard from "../../app/field/components/Dashboard";

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

describe("BuildingWizard", () => {
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
