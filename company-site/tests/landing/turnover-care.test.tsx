import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LandingPage from "../../app/landing/LandingPage";
import { landingServices } from "../../app/landing/services";
import { metadata } from "../../app/turnover-care/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("24H turnover care landing", () => {
  it("qualifies the 24H operating standard and shows the proactive timeline", () => {
    render(<LandingPage service={landingServices["turnover-care"]} />);

    expect(
      screen.getByRole("heading", {
        name: /퇴실 후에 움직이지 않습니다.*14일 전부터 준비합니다/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/퇴실 확인 시점부터 24시간 안에/)).toBeInTheDocument();
    expect(screen.getAllByText("D-14 접수").length).toBeGreaterThan(0);
    expect(screen.getAllByText("퇴실 확인").length).toBeGreaterThan(0);
    expect(screen.getAllByText("D+1 인계 준비").length).toBeGreaterThan(0);
    expect(screen.getByText(/중대한 추가 수리가 없는 경우/)).toBeInTheDocument();
    expect(screen.getAllByText(/승인한 작업금액의 5%/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/무조건 공실 0일/)).not.toBeInTheDocument();
    expect(screen.queryByText(/24시간 안에 새 임차인/)).not.toBeInTheDocument();
  });

  it("publishes route-specific metadata", () => {
    expect(metadata.title).toMatch(/24H 입·퇴실 관리/);
    expect(metadata.description).toMatch(/퇴실 14일 전/);
    expect(metadata.alternates).toEqual({ canonical: "/turnover-care" });
  });
});
