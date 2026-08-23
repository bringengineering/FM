import "@testing-library/jest-dom/vitest";
import { render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LandingPage from "../../app/landing/LandingPage";
import { landingServices } from "../../app/landing/services";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("LandingPage", () => {
  it("owns the estimate anchor at the section level without duplicate ids", () => {
    const { container } = render(
      <LandingPage service={landingServices["stair-cleaning"]} />,
    );

    expect(container.querySelector("section#quick-estimate")).toBeInTheDocument();
    expect(container.querySelectorAll("#quick-estimate")).toHaveLength(1);
  });

  it("separates the base service scope from separately priced work", () => {
    const { container } = render(
      <LandingPage service={landingServices["stair-cleaning"]} />,
    );
    const priceSection = container.querySelector(".landing-price");

    expect(priceSection).toBeInTheDocument();
    expect(within(priceSection as HTMLElement).getByText("기본 서비스 범위")).toBeInTheDocument();
    expect(within(priceSection as HTMLElement).getByText("별도 협의 항목")).toBeInTheDocument();
  });
});
