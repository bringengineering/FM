import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BuildingCarePage from "../../app/building-care/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("BuildingCarePage sales landing", () => {
  it("tells the owner-facing sales story in the approved order", () => {
    const { container } = render(<BuildingCarePage />);

    expect(
      screen.getByRole("heading", { name: /건물은 임대하고,.*관리는 맡기세요/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("월 89,000원부터").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: /관리창구를.*하나로/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /퇴실하는 순간부터/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /공실의.*시간.*관리/ })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "말보다 현장으로 보여드립니다." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /건물에 가지 않아도/ })).toBeInTheDocument();
    expect(container.querySelector("#quick-estimate-form")).toBeInTheDocument();

    const sectionIds = Array.from(container.querySelectorAll("main > section")).map(
      (section) => section.id,
    );
    expect(sectionIds).toEqual([
      "building-care-hero",
      "owner-problem",
      "one-contact",
      "care-system",
      "management-process",
      "turnover-package",
      "turnover-time",
      "building-care-price",
      "entry-services",
      "real-cases",
      "management-report",
      "trust-operations",
      "building-care-faq",
      "building-care-consultation",
    ]);
  });

  it("renders visual proof and preserves the verified contact paths", () => {
    const { container } = render(<BuildingCarePage />);

    expect(container.querySelector(".bc-hero-visual")).toBeInTheDocument();
    expect(container.querySelector(".bc-contact-network")).toBeInTheDocument();
    expect(container.querySelector(".bc-turnover-track")).toBeInTheDocument();
    expect(container.querySelector(".bc-parallel-track")).toBeInTheDocument();
    expect(container.querySelector(".bc-report-ui")).toBeInTheDocument();
    expect(container.querySelectorAll(".bc-case-card img").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("관리보고 화면 예시")).toBeInTheDocument();
    expect(screen.getAllByText("010-6566-3603").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /카카오톡/ })).toHaveAttribute(
      "href",
      "https://pf.kakao.com/_xnaRfX/chat",
    );
  });

  it("explains the service with certifications, comparisons, and visual steps", () => {
    const { container } = render(<BuildingCarePage />);

    expect(container.querySelectorAll(".bc-cert-card")).toHaveLength(3);
    expect(container.querySelectorAll(".bc-service-visual")).toHaveLength(6);
    expect(container.querySelector(".bc-management-comparison")).toBeInTheDocument();
    expect(container.querySelector(".bc-scope-table")).toBeInTheDocument();
    expect(container.querySelectorAll(".bc-cycle-step")).toHaveLength(4);
    expect(container.querySelector(".bc-standard-stack")).toBeInTheDocument();
    expect(screen.getByText(/별도 비용이 필요한 작업은/)).toBeInTheDocument();
    expect(screen.queryByText(/4\.9점|최우수|100% 보상/)).not.toBeInTheDocument();
  });

  it("opens with the stair team manifesto and a compact trust bar", () => {
    const { container } = render(<BuildingCarePage />);
    const teamImage = container.querySelector(".bc-team-manifesto img");

    expect(teamImage).toHaveAttribute(
      "src",
      expect.stringContaining("bringcare-team-stair-v1.png"),
    );
    expect(
      screen.getByText("BRING CARE 브랜드 캠페인 이미지"),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".bc-trust-badge")).toHaveLength(3);
    expect(container.querySelector(".bc-cert-trust-bar")).toHaveAttribute(
      "href",
      "#company-certifications",
    );
  });
});
