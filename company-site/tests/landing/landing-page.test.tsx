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
  it("puts the cleaning offer and concrete cleaning result before building care", () => {
    const { container, getByRole, getByText } = render(
      <LandingPage service={landingServices["stair-cleaning"]} />,
    );
    const scopeSection = container.querySelector(".landing-scope");

    expect(
      getByRole("heading", { name: /원주 계단·공용부 정기청소/ }),
    ).toBeInTheDocument();
    expect(scopeSection).toBeInTheDocument();
    expect(within(scopeSection as HTMLElement).getByText("계단·난간")).toBeInTheDocument();
    expect(within(scopeSection as HTMLElement).getByText("복도 바닥")).toBeInTheDocument();
    expect(within(scopeSection as HTMLElement).getByText("공동현관")).toBeInTheDocument();
    expect(within(scopeSection as HTMLElement).getByText("공용창·창틀")).toBeInTheDocument();
    expect(
      getByRole("heading", { name: "청소 후 이렇게 달라집니다." }),
    ).toBeInTheDocument();
    expect(getByText("먼지·오염 제거")).toBeInTheDocument();
    expect(getByText("손이 닿는 곳 정리")).toBeInTheDocument();
    expect(getByText("완료 사진 전달")).toBeInTheDocument();
    expect(getByText("청소 작업 예시 이미지")).toBeInTheDocument();
    expect(getByRole("link", { name: "사진 출처: Pexels" })).toHaveAttribute(
      "href",
      "https://www.pexels.com/photo/man-wearing-an-orange-coveralls-6197123/",
    );
  });

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

  it("connects service evidence to the complete archive", () => {
    const { getByRole } = render(
      <LandingPage service={landingServices["building-care"]} />,
    );

    expect(
      getByRole("link", { name: /현장기록 12건 전체 보기/ }),
    ).toHaveAttribute("href", "/care-records");
  });

  it("shows truthful official channel guidance without invented social URLs", () => {
    const { getByRole, getByText } = render(
      <LandingPage service={landingServices["stair-cleaning"]} />,
    );

    expect(getByRole("link", { name: "BRING CARE 네이버 블로그" })).toHaveAttribute(
      "href",
      "https://blog.naver.com/bringcare",
    );
    expect(getByText(/카카오톡에서.*BRING Care.*검색/)).toBeInTheDocument();
    expect(getByText(/인스타그램 공식 계정 주소 확인 후 연결/)).toBeInTheDocument();
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
    expect(css).toMatch(
      /\.landing-brand \.brand-image\s*\{[\s\S]*?background-size:\s*contain/,
    );
    expect(css).toMatch(
      /@media \(max-width: 940px\)[\s\S]*?\.landing-hero-actions\s*\{[\s\S]*?flex-direction:\s*column/,
    );
    expect(css).toMatch(
      /\.care-records-logo\s*\{[\s\S]*?background-color:\s*var\(--white\)/,
    );
    expect(css).not.toMatch(/\.care-records-logo\s*\{[^}]*filter:/);
  });
});
