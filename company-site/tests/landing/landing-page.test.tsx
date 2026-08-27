import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import LandingPage from "../../app/landing/LandingPage";
import MoveInCleaningLanding from "../../app/landing/MoveInCleaningLanding";
import StairCleaningLanding from "../../app/landing/StairCleaningLanding";
import { landingServices } from "../../app/landing/services";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("LandingPage", () => {
  it("renders a dedicated move-in cleaning page with only move-in cleaning scenes", () => {
    const { container } = render(<MoveInCleaningLanding />);

    expect(
      screen.getByRole("heading", { name: /새 공간의 첫날/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("브링케어 서비스 연출 이미지")).not.toBeInTheDocument();
    expect(screen.getAllByText("일반 단건 입·퇴실청소")).toHaveLength(2);
    expect(screen.getByText("관리 건물 입·퇴실청소")).toBeInTheDocument();
    expect(container.querySelector("#quick-estimate-form")).toBeInTheDocument();
    expect(
      screen.getAllByAltText(/브링케어 유니폼 작업자의 욕실 배수구 청소/)[0],
    ).toHaveAttribute(
      "src",
      "/landing/cleaning/bringcare-bathroom-drain-cleaning.png",
    );
    expect(screen.queryByAltText(/계단 밀대 청소/)).not.toBeInTheDocument();
  });

  it("renders the approved Toss-style stair cleaning sales page with the live estimate form", () => {
    const { container } = render(<StairCleaningLanding />);

    expect(
      screen.getByRole("heading", {
        name: /계단청소를 넘어,.*건물의 첫인상을.*관리합니다\./,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("월 4회 정기방문")).toHaveLength(2);
    expect(screen.getAllByText("월간 관리보고")).toHaveLength(2);
    expect(screen.getByText("시설 상태 확인")).toBeInTheDocument();
    expect(screen.getByText("원주 직영팀")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "깨끗하게만 하지 않습니다." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /한 달의 관리 내용을.*보고서로 확인하세요\./ }),
    ).toBeInTheDocument();
    expect(screen.getByText("3층 건물")).toBeInTheDocument();
    expect(screen.getByText("월 60,000원")).toBeInTheDocument();
    expect(container.querySelector("#quick-estimate-form")).toBeInTheDocument();
    expect(screen.queryByText("브링케어 서비스 연출 이미지")).not.toBeInTheDocument();
    expect(screen.getAllByAltText(/검은 정장을 입은 브링케어 관리자가 계단 바닥을 청소/)[0]).toHaveAttribute(
      "src",
      "/landing/campaign/suit-stair-floor.png",
    );
    expect(screen.queryByAltText(/욕실 배수구 청소/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /무료 견적 신청.*30초 만에 입력하기/ }),
    ).toHaveAttribute("href", "#estimate");
  });

  it("separates staged cleaning visuals from four verified Bring Care field references", () => {
    const { container } = render(<StairCleaningLanding />);
    const references = container.querySelector(".stair-references");

    expect(references).toBeInTheDocument();
    expect(
      within(references as HTMLElement).getByRole("heading", {
        name: /말보다 현장으로.*보여드립니다\./,
      }),
    ).toBeInTheDocument();
    expect(
      within(references as HTMLElement).getAllByText("BRING CARE 실제 관리 기록"),
    ).toHaveLength(4);
    expect(
      within(references as HTMLElement).getByText("공용부 환경 정비"),
    ).toBeInTheDocument();
    expect(
      within(references as HTMLElement).getByText("청소 중 발견한 벽면 하자"),
    ).toBeInTheDocument();
    expect(
      within(references as HTMLElement).getByText("전기 화재예방 조치"),
    ).toBeInTheDocument();
    expect(
      within(references as HTMLElement).getByText("건물 입구 안내환경 개선"),
    ).toBeInTheDocument();
    expect(
      within(references as HTMLElement).getAllByRole("link", {
        name: /실제 현장기록 보기/,
      }),
    ).toHaveLength(4);
  });

  it("explains the problem, action, and result for every verified field reference", () => {
    const { container } = render(<StairCleaningLanding />);
    const references = container.querySelector(".stair-references");

    expect(screen.getByText("서비스 작업 범위")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /말보다 현장으로.*보여드립니다/ }),
    ).toBeInTheDocument();
    expect(
      within(references as HTMLElement).getAllByText("BRING CARE 실제 관리 기록"),
    ).toHaveLength(4);
    expect(within(references as HTMLElement).getAllByText("확인한 문제")).toHaveLength(4);
    expect(within(references as HTMLElement).getAllByText("진행한 조치")).toHaveLength(4);
    expect(within(references as HTMLElement).getAllByText("관리 결과")).toHaveLength(4);
    expect(container.querySelectorAll(".stair-reference-detail")).toHaveLength(4);
  });

  it("presents eight campaign service scenes and a fixed recurring-cleaning price", () => {
    const { container } = render(<StairCleaningLanding />);

    expect(screen.getByText("청소까지 관리의 일부니까.")).toBeInTheDocument();
    expect(container.querySelectorAll(".stair-campaign-card")).toHaveLength(8);
    [
      "계단 바닥",
      "계단 손잡이·난간",
      "계단 모서리·틈새",
      "천장·거미줄",
      "공용부 입구 창문",
      "우편함 주변",
      "낙엽·생활 쓰레기",
      "주차장 바닥",
    ].forEach((label) => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
    expect(
      screen.getByText(/기본 정기청소 범위는 정찰제로 운영합니다/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/오염도와 관리 범위에 따라 변동/),
    ).not.toBeInTheDocument();
  });

  it("uses a dense two-column campaign grid and shared depth surfaces", () => {
    const { container } = render(<StairCleaningLanding />);

    expect(container.querySelector(".stair-campaign-grid")).toBeInTheDocument();
    expect(container.querySelectorAll(".stair-campaign-card")).toHaveLength(8);
    expect(
      container.querySelectorAll(".stair-depth-card").length,
    ).toBeGreaterThanOrEqual(8);
  });

  it("answers scope, process, and contract questions before the stair-cleaning estimate", () => {
    render(<StairCleaningLanding />);

    expect(
      screen.getByRole("heading", { name: /기본 청소와 별도 작업을.*미리 구분했습니다/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("계단 손잡이·난간").length).toBeGreaterThan(0);
    expect(screen.getByText("바닥 왁스·코팅")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /상담부터 월간보고까지.*한 흐름으로 진행합니다/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("01 상담 접수")).toBeInTheDocument();
    expect(screen.getByText("04 월간 관리보고")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "자주 묻는 질문" }),
    ).toBeInTheDocument();
    expect(screen.getByText("건물주가 현장에 있어야 하나요?")).toBeInTheDocument();
    expect(screen.getByText("세금계산서 발행이 가능한가요?")).toBeInTheDocument();
  });
  it.each([
    ["stair-cleaning", /원주 계단·공용부 정기청소/],
    ["building-care", /멀리 있어도,.*우리 건물의 오늘을 확인할 수 있습니다\./],
    ["move-in-cleaning", /새 공간의 첫날,.*작업 범위와 완료 사진으로 확인하세요\./],
  ] as const)(
    "limits the turnover-specific intro to the turnover route for %s",
    (slug, heading) => {
      const { container } = render(
        <LandingPage service={landingServices[slug]} />,
      );

      expect(container.querySelector(".turnover-intro")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    },
  );

  it("publishes the confirmed phone, VAT note, and turnover-care path", () => {
    const { rerender } = render(
      <LandingPage service={landingServices["stair-cleaning"]} />,
    );

    expect(screen.getAllByRole("link", { name: /010-6566-3603/ })[0]).toHaveAttribute(
      "href",
      "tel:01065663603",
    );
    expect(screen.getByText("모든 금액은 부가세 별도입니다.")).toBeInTheDocument();
    expect(
      screen.getByText("3층 6만원 · 4층 7만원 · 5층 8만원"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /입·퇴실까지 함께 관리하기/ }),
    ).toHaveAttribute("href", "/turnover-care");

    rerender(<LandingPage service={landingServices["building-care"]} />);
    expect(screen.getByText("8만 9천원부터")).toBeInTheDocument();

    rerender(<LandingPage service={landingServices["move-in-cleaning"]} />);
    expect(screen.getByText("관리 건물 입·퇴실청소")).toBeInTheDocument();
    expect(screen.getByText("일반 단건 입·퇴실청소")).toBeInTheDocument();
  });

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

  it.each([
    "stair-cleaning",
    "building-care",
    "move-in-cleaning",
    "turnover-care",
  ] as const)("opens one quick estimate dialog from the %s landing CTA", (slug) => {
    const { container } = render(<LandingPage service={landingServices[slug]} />);
    const trigger = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href="#quick-estimate"]'),
    )[0];

    expect(trigger).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(container.querySelectorAll("#quick-estimate")).toHaveLength(1);
  });

  it("separates included scope from separately priced work", () => {
    const { container } = render(
      <LandingPage service={landingServices["stair-cleaning"]} />,
    );
    const priceSection = container.querySelector(".landing-pricing");

    expect(priceSection).toBeInTheDocument();
    expect(within(priceSection as HTMLElement).getByText("계단·공용부 정기청소")).toBeInTheDocument();
    expect(
      within(priceSection as HTMLElement).getByText(/현장 작업비.*전문업체 시공비는 별도/),
    ).toBeInTheDocument();
  });

  it("connects service evidence to the complete archive", () => {
    const { getByRole } = render(
      <LandingPage service={landingServices["building-care"]} />,
    );

    expect(
      getByRole("link", { name: /현장기록 12건 전체 보기/ }),
    ).toHaveAttribute("href", "/care-records");
  });

  it("links the verified official Kakao consultation channel", () => {
    const { getByRole, getByText } = render(
      <LandingPage service={landingServices["stair-cleaning"]} />,
    );

    expect(getByRole("link", { name: "BRING CARE 네이버 블로그" })).toHaveAttribute(
      "href",
      "https://blog.naver.com/bringcare",
    );
    expect(getByRole("link", { name: /카카오톡 바로 상담/ })).toHaveAttribute(
      "href",
      "https://pf.kakao.com/_xnaRfX/chat",
    );
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

  it("gives mobile cleaning headings and gallery cards more breathing room", () => {
    const css = readFileSync(
      resolve(process.cwd(), "app/landing/stair-cleaning.css"),
      "utf8",
    );

    expect(css).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.stair-section h2[\s\S]*?line-height:\s*1\.22/,
    );
    expect(css).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.stair-gallery figure[\s\S]*?aspect-ratio:\s*1\s*\/\s*1[\s\S]*?height:\s*auto/,
    );
    expect(css).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.stair-gallery\s*\{[\s\S]*?gap:\s*24px/,
    );
  });
});
