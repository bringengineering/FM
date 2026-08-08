import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AppShell from "../../app/field/components/AppShell";
import AuthGate from "../../app/field/components/AuthGate";
import FieldMapPanel from "../../app/field/components/FieldMapPanel";

describe("FieldMapPanel", () => {
  it("embeds the real BRING Wonju map instead of a placeholder", () => {
    render(<FieldMapPanel />);

    const map = screen.getByTitle("BRING 원주 건물 유지보수 지도");
    expect(map).toHaveAttribute("src", expect.stringContaining("wonju-map.html"));
    expect(screen.queryByText("기능을 연결하고 있습니다")).not.toBeInTheDocument();
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
