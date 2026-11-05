import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PricingGrid from "../../app/landing/PricingGrid";

describe("PricingGrid", () => {
  it("shows every approved price, VAT status, and separately priced work", () => {
    render(<PricingGrid activePrice="stair-cleaning" />);

    expect(screen.getByText("8만 9천원부터")).toBeInTheDocument();
    expect(
      screen.getByText("3층 6만원 · 4층 7만원 · 5층 8만원"),
    ).toBeInTheDocument();
    expect(screen.getByText("10만원부터")).toBeInTheDocument();
    expect(screen.getByText("12만원부터")).toBeInTheDocument();
    expect(screen.getAllByText("부가세 별도")).toHaveLength(4);
    expect(screen.getByText(/승인한 작업금액의 5%/)).toBeInTheDocument();
  });

  it("emphasizes only the page-relevant price", () => {
    const { container } = render(<PricingGrid activePrice="building-care" />);

    expect(container.querySelectorAll(".landing-price-plan-active")).toHaveLength(1);
    expect(container.querySelector('[data-price-id="building-care"]')).toHaveClass(
      "landing-price-plan-active",
    );
  });
});
