import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
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
    const intro = container.querySelector<HTMLElement>(".turnover-intro");

    expect(intro).toBeInTheDocument();
    expect(
      within(intro as HTMLElement).getByRole("heading", {
        name: "퇴실 다음 날, 바로 보여줄 수 있는 방으로.",
      }),
    ).toBeInTheDocument();
    expect(
      within(intro as HTMLElement).getByText("BRING CARE 24H 입·퇴실 관리"),
    ).toBeInTheDocument();

    const process = within(intro as HTMLElement).getByRole("region", {
      name: "24H 입·퇴실 관리 운영 과정",
    });
    const steps = within(process).getAllByRole("listitem");

    expect(steps).toHaveLength(4);
    ["D-14 사전 접수", "퇴실 상태 확인", "직영 청소·조치", "완료 사진 전달"].forEach(
      (title, index) => {
        expect(within(steps[index]).getByText(title)).toBeInTheDocument();
      },
    );
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

  it("connects the turnover navigation to one operating standard region", () => {
    const { container } = render(
      <LandingPage service={landingServices["turnover-care"]} />,
    );

    expect(
      screen.getByRole("link", { name: "24H 입·퇴실 관리" }),
    ).toHaveAttribute("href", "#turnover-standard");
    expect(container.querySelector("#turnover-standard")).toBeInTheDocument();
    expect(container.querySelectorAll("#turnover-standard")).toHaveLength(1);
  });

  it("qualifies the 24H operating standard without vacancy guarantees", () => {
    render(<LandingPage service={landingServices["turnover-care"]} />);
    const standard = screen.getByRole("region", {
      name: "빠르다는 말보다, 준비된 과정을 보여드립니다.",
    });

    expect(
      within(standard).getByRole("heading", {
        name: "빠르다는 말보다, 준비된 과정을 보여드립니다.",
      }),
    ).toBeInTheDocument();
    expect(standard).toHaveTextContent(
      /퇴실 14일 전까지 접수되고 출입·작업 범위·비용 승인이 완료된 호실 중\s*중대한 추가 수리가 없는 경우, 퇴실 확인 시점부터 24시간 안에/,
    );
    expect(screen.queryByText(/무조건 공실 0일/)).not.toBeInTheDocument();
    expect(screen.queryByText(/24시간 안에 새 임차인/)).not.toBeInTheDocument();
  });

  it("links the 24H standard to the detailed conditions region", () => {
    render(<LandingPage service={landingServices["turnover-care"]} />);

    expect(
      screen.getByRole("link", { name: "24H 적용 조건 자세히 보기" }),
    ).toHaveAttribute("href", "#turnover-conditions");
    expect(
      screen.getByRole("region", {
        name: /직접 하는 일과 승인이 필요한 일을 구분합니다\./,
      }),
    ).toHaveAttribute("id", "turnover-conditions");
  });

  it("publishes route-specific metadata", () => {
    expect(metadata.title).toMatch(/24H 입·퇴실 관리/);
    expect(metadata.description).toMatch(/퇴실 14일 전/);
    expect(metadata.alternates).toEqual({ canonical: "/turnover-care" });
  });
});
