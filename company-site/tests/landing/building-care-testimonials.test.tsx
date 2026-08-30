import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BuildingCareTestimonials, {
  type BuildingCareTestimonial,
} from "../../app/landing/BuildingCareTestimonials";

describe("BuildingCareTestimonials", () => {
  it("renders nothing until verified customer evidence exists", () => {
    const { container } = render(<BuildingCareTestimonials items={[]} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/4\.9/)).not.toBeInTheDocument();
  });

  it("renders only supplied verified review data", () => {
    const item: BuildingCareTestimonial = {
      id: "verified-review-1",
      customerType: "원주 다가구 건물주",
      quote: "방문 결과가 정리되어 있어 확인하기 편했습니다.",
      image: "/landing/building-care/reference-01.webp",
      imageAlt: "실제 관리 현장",
      tags: ["월간보고", "현장확인"],
    };

    render(<BuildingCareTestimonials items={[item]} />);

    expect(screen.getByRole("heading", { name: "실제 이용 후기로 확인하세요." })).toBeInTheDocument();
    expect(screen.getByText(item.quote)).toBeInTheDocument();
    expect(screen.getByText(item.customerType)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: item.imageAlt })).toBeInTheDocument();
  });
});
