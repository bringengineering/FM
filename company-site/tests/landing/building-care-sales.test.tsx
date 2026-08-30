import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BuildingCarePage from "../../app/building-care/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("BuildingCarePage sales landing", () => {
  it("tells the owner-facing sales story in the approved order", () => {
    const { container } = render(<BuildingCarePage />);

    expect(
      screen.getByRole("heading", { name: /BRING CARE는 건물을 관리하며/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("월 89,000원부터").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: /건물주의 가치를 높이는.*BRING CARE/ }),
    ).toBeInTheDocument();
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
      "owner-problem",
      "one-contact",
      "real-estate-partnership",
      "service-menu",
      "management-cycle",
      "real-cases",
      "management-report",
      "management-comparison",
      "management-scope",
      "building-care-price",
      "turnover-package",
      "turnover-time",
      "operating-standard",
      "trust-operations",
      "company-certifications",
      "building-care-faq",
      "building-care-consultation",
    ]);
  });

  it("renders visual proof and preserves the verified contact paths", () => {
    const { container } = render(<BuildingCarePage />);

    expect(container.querySelector(".bc-team-stage")).toBeInTheDocument();
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

  it("opens with the team identity and uses relevant visual language", () => {
    const { container } = render(<BuildingCarePage />);
    const main = container.querySelector("main")!;
    const team = main.querySelector(".bc-team-manifesto")!;
    expect(main.firstElementChild).toBe(team);
    expect(container.querySelectorAll(".bc-problem-icon")).toHaveLength(3);
    expect(
      Array.from(container.querySelectorAll(".bc-cycle-step img")).map((image) =>
        image.getAttribute("src"),
      ),
    ).toEqual([
      expect.stringContaining("/landing/building-care-flow/check.webp"),
      expect.stringContaining("/landing/building-care-flow/coordinate.webp"),
      expect.stringContaining("/landing/building-care-flow/resolve.webp"),
      expect.stringContaining("/landing/building-care-flow/report.webp"),
    ]);
    expect(main).not.toHaveTextContent(/우리는|우리 건물/);
  });

  it("uses the transparent team hero and an infographic-style contact hub", () => {
    const { container } = render(<BuildingCarePage />);

    expect(container.querySelector("#building-care-hero")).not.toBeInTheDocument();
    expect(container.querySelector(".bc-team-manifesto")).toHaveClass(
      "bc-team-manifesto-overlay",
    );
    expect(container.querySelectorAll(".bc-contact-service")).toHaveLength(5);
    expect(container.querySelectorAll(".bc-contact-value")).toHaveLength(4);
    expect(
      screen.getByRole("heading", { name: /건물주의 가치를 높이는/ }),
    ).toBeInTheDocument();
  });

  it("connects vacancy preparation to Easy Real Estate brokerage with explicit roles", () => {
    const { container } = render(<BuildingCarePage />);
    const oneContact = container.querySelector("#one-contact");
    const partnership = container.querySelector("#real-estate-partnership");

    expect(partnership).toBeInTheDocument();
    expect(oneContact?.nextElementSibling).toBe(partnership);
    expect(
      within(partnership as HTMLElement).getByRole("heading", {
        name: "공실 확인에서 임대차 중개까지, 한 흐름으로 연결합니다.",
      }),
    ).toBeInTheDocument();
    expect(
      within(partnership as HTMLElement).getByText(
        "BRING CARE × 이지부동산중개법인",
      ),
    ).toBeInTheDocument();
    expect(
      within(partnership as HTMLElement).getByText(
        "건물관리는 BRING CARE가, 임대차 중개는 이지부동산중개법인이 담당합니다.",
      ),
    ).toBeInTheDocument();
    expect(
      within(partnership as HTMLElement).getAllByRole("listitem"),
    ).toHaveLength(4);
    expect(
      within(partnership as HTMLElement).getByRole("link", {
        name: "공실·임대관리 상담",
      }),
    ).toHaveAttribute("href", "#building-care-consultation");
    expect(partnership).not.toHaveTextContent(
      /공실 해소 보장|임대 보장|계약 보장/,
    );
  });

  it("orders the sales story from promise to proof and conversion", () => {
    const { container } = render(<BuildingCarePage />);
    const main = container.querySelector("main")!;
    const order = [
      ".bc-team-manifesto",
      ".bc-cert-trust-bar",
      "#owner-problem",
      ".bc-cycle-grid",
      "#real-cases",
      "#management-report",
      ".bc-mid-cta",
      ".bc-management-comparison",
      "#building-care-price",
      "#company-certifications",
      "#building-care-consultation",
    ].map((selector) => main.querySelector(selector));

    order.forEach((node) => expect(node).toBeInTheDocument());
    for (let index = 1; index < order.length; index += 1) {
      expect(
        order[index - 1]!.compareDocumentPosition(order[index]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(container.querySelector(".bc-mid-cta a[href='#quick-estimate']")).toHaveTextContent(
      "무료 관리진단 신청",
    );
  });
});
