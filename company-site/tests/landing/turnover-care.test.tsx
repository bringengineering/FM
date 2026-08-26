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
  it("presents the dedicated turnover hero and four-step operating flow", () => {
    const { container } = render(
      <LandingPage service={landingServices["turnover-care"]} />,
    );

    expect(
      screen.getByRole("heading", {
        name: "퇴실 다음 날, 바로 보여줄 수 있는 방으로.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("BRING CARE 24H 입·퇴실 관리")).toBeInTheDocument();
    expect(screen.getByText("D-14 사전 접수")).toBeInTheDocument();
    expect(screen.getByText("퇴실 상태 확인")).toBeInTheDocument();
    expect(screen.getByText("직영 청소·조치")).toBeInTheDocument();
    expect(screen.getByText("완료 사진 전달")).toBeInTheDocument();
    expect(container.querySelector(".turnover-intro")).toBeInTheDocument();
  });

  it("offers the dedicated turnover consultation routes", () => {
    render(<LandingPage service={landingServices["turnover-care"]} />);

    expect(screen.getByRole("link", { name: "퇴실 일정 상담하기" })).toHaveAttribute(
      "href",
      "#quick-estimate",
    );
    expect(screen.getByRole("link", { name: "카카오톡 상담" })).toHaveAttribute(
      "href",
      "https://pf.kakao.com/_xnaRfX/chat",
    );
    expect(screen.getByRole("link", { name: "010-6566-3603" })).toHaveAttribute(
      "href",
      "tel:01065663603",
    );
  });

  it("qualifies the 24H operating standard without vacancy guarantees", () => {
    render(<LandingPage service={landingServices["turnover-care"]} />);

    expect(
      screen.getByRole("heading", {
        name: "빠르다는 말보다, 준비된 과정을 보여드립니다.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/퇴실 확인 시점부터 24시간 안에/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "24H 적용 조건 자세히 보기" }),
    ).toHaveAttribute("href", "#turnover-conditions");
    expect(screen.queryByText(/무조건 공실 0일/)).not.toBeInTheDocument();
    expect(screen.queryByText(/24시간 안에 새 임차인/)).not.toBeInTheDocument();
  });

  it("publishes route-specific metadata", () => {
    expect(metadata.title).toMatch(/24H 입·퇴실 관리/);
    expect(metadata.description).toMatch(/퇴실 14일 전/);
    expect(metadata.alternates).toEqual({ canonical: "/turnover-care" });
  });
});
