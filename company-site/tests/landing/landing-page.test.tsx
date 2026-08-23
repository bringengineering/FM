import "@testing-library/jest-dom/vitest";
import { render, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("describes required and optional estimate information accurately", () => {
    const { container } = render(
      <LandingPage service={landingServices["stair-cleaning"]} />,
    );
    const estimateSection = container.querySelector(".landing-estimate");

    expect(estimateSection).toHaveTextContent(
      "이름, 연락처, 건물 위치 또는 지역은 필수입니다.",
    );
    expect(estimateSection).toHaveTextContent("건물 정보는 선택");
  });

  it("keeps the estimate layout and focus treatment safe across breakpoints", () => {
    const css = readFileSync(
      resolve(process.cwd(), "app/landing/landing.css"),
      "utf8",
    );

    expect(css).toMatch(
      /@media \(max-width: 940px\)[\s\S]*?\.landing-estimate-layout\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
    );
    expect(css).toMatch(/:focus-visible[\s\S]*?outline:\s*3px solid var\(--blue\)/);
    expect(css).toMatch(/landing-records[\s\S]*?:focus-visible[\s\S]*?var\(--lime\)/);
    expect(css).toMatch(/landing-price-line span[\s\S]*?font-size:\s*13px/);
    expect(css).toMatch(/landing-record-grid[\s\S]*?repeat\(auto-fit/);
  });
});
