import "@testing-library/jest-dom/vitest";
import fs from "node:fs";
import path from "node:path";
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

    const navigation = screen.getByRole("navigation", {
      name: "24H 입·퇴실 관리 페이지 이동",
    });
    const navigationLinks = within(navigation).getAllByRole("link");
    expect(
      navigationLinks.filter((link) =>
        link.classList.contains("turnover-nav-cta"),
      ),
    ).toEqual([screen.getByRole("link", { name: "30초 견적" })]);
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

  it("keeps the turnover intro visual system scoped and responsive", () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), "app/landing/landing.css"),
      "utf8",
    );
    const collectedRules: Array<{
      context: string;
      selector: string;
      declarations: string;
    }> = [];
    const collectRules = (source: string, context = "base") => {
      let cursor = 0;

      while (cursor < source.length) {
        const open = source.indexOf("{", cursor);
        if (open < 0) break;
        const prelude = source.slice(cursor, open).trim();
        let depth = 1;
        let close = open + 1;

        while (close < source.length && depth > 0) {
          if (source[close] === "{") depth += 1;
          if (source[close] === "}") depth -= 1;
          close += 1;
        }

        const body = source.slice(open + 1, close - 1);
        if (prelude.startsWith("@media")) {
          collectRules(body, prelude.replace(/\s+/g, " "));
        } else if (prelude && !prelude.startsWith("@")) {
          prelude.split(",").forEach((selector) => {
            collectedRules.push({
              context,
              selector: selector.trim(),
              declarations: body,
            });
          });
        }
        cursor = close;
      }
    };
    collectRules(css.replace(/\/\*[\s\S]*?\*\//g, ""));
    const rule = (selector: string, context = "base") => {
      const matches = collectedRules.filter(
        (item) => item.selector === selector && item.context === context,
      );

      expect(
        matches,
        `expected one CSS rule for ${selector} in ${context}`,
      ).toHaveLength(1);
      return matches[0]?.declarations ?? "";
    };
    const expectNoRule = (selector: string, context: string) => {
      expect(
        collectedRules.filter(
          (item) => item.selector === selector && item.context === context,
        ),
        `unexpected CSS rule for ${selector} in ${context}`,
      ).toHaveLength(0);
    };
    const tablet = "@media (max-width: 860px)";
    const mobile = "@media (max-width: 760px)";
    const tokens = rule(".landing-turnover-care");
    const header = rule(".landing-turnover-care .turnover-intro-header");
    const navCta = rule(
      ".landing-turnover-care .turnover-intro-nav .turnover-nav-cta",
    );
    const hero = rule(".landing-turnover-care .turnover-intro-hero");
    const overlay = rule(".landing-turnover-care .turnover-intro-overlay");
    const heroActions = rule(
      ".landing-turnover-care .turnover-intro-actions a",
    );
    const introCopy = rule(
      ".landing-turnover-care .turnover-intro-copy",
    );
    const secondaryAction = rule(
      ".landing-turnover-care .turnover-secondary-action",
    );
    const introMeta = rule(
      ".landing-turnover-care .turnover-intro-meta",
    );
    const processRule = rule(
      ".landing-turnover-care .turnover-intro-process ol",
    );
    const processContainer = rule(
      ".landing-turnover-care .turnover-intro-process",
    );
    const processItem = rule(
      ".landing-turnover-care .turnover-intro-process li",
    );
    const standardStatement = rule(
      ".landing-turnover-care .turnover-standard-statement",
    );

    [
      ["blue", "#1768ff"],
      ["deep-blue", "#083f91"],
      ["navy", "#092c5c"],
      ["ink", "#191f28"],
      ["muted", "#6b7684"],
      ["line", "#e5e8eb"],
      ["max", "1240px"],
      ["landing-gutter", "24px"],
    ].forEach(([name, value]) => {
      expect(tokens).toMatch(new RegExp(`--${name}:\\s*${value}`, "i"));
    });
    expect(tokens).toMatch(
      /--brand-gradient:\s*linear-gradient\(145deg,\s*#1768ff\s+0%,\s*#083f91\s+100%\)/i,
    );
    expect(header).toMatch(/min-height:\s*64px/i);
    [header, hero, processContainer].forEach((layoutRule) => {
      expect(layoutRule).toMatch(/width:\s*min\(/i);
      expect(layoutRule).toMatch(
        /calc\(100%\s*-\s*\(2\s*\*\s*var\(--landing-gutter\)\)\)/i,
      );
      expect(layoutRule).toMatch(/var\(--max\)/i);
    });
    expect(navCta).toMatch(/border-radius:\s*12px/i);
    expect(navCta).toMatch(/min-height:\s*52px/i);
    expect(navCta).toMatch(/padding-inline:\s*22px/i);
    expect(hero).toMatch(/border-radius:\s*40px/i);
    expect(overlay).toMatch(/background:\s*linear-gradient\(\s*90deg,/i);
    expect(introCopy).toMatch(/justify-content:\s*center/i);
    expect(heroActions).toMatch(/min-height:\s*52px/i);
    expect(heroActions).toMatch(/border-radius:\s*12px/i);
    expect(heroActions).toMatch(/padding-inline:\s*22px/i);
    expect(secondaryAction).toMatch(
      /border-color:\s*rgba\(255,\s*255,\s*255,\s*0\.44\)/i,
    );
    expect(introMeta).toMatch(/gap:\s*24px/i);
    expect(introMeta).toMatch(
      /border-top:\s*1px\s+solid\s+rgba\(255,\s*255,\s*255,\s*0\.26\)/i,
    );
    expect(processRule).toMatch(/grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/i);
    expect(processRule).toMatch(/border-block:\s*1px\s+solid\s+var\(--line\)/i);
    expect(processItem).toMatch(/border-right:\s*1px\s+solid\s+var\(--line\)/i);
    expect(
      rule(".landing-turnover-care .turnover-intro-process h3"),
    ).toMatch(/letter-spacing:\s*-0\.04em/i);
    expect(
      rule(".landing-turnover-care .turnover-intro-process li p"),
    ).toMatch(/line-height:\s*1\.6/i);
    expect(
      rule(".landing-turnover-care .turnover-intro-process li:last-child"),
    ).toMatch(/border-right:\s*0/i);
    expect(standardStatement).not.toMatch(/background:\s*rgba\([^)]*255/i);
    expect(standardStatement).not.toMatch(/border-radius:/i);

    expect(rule(".landing-turnover-care", mobile)).toMatch(
      /--landing-gutter:\s*14px/i,
    );
    const mobileNavCta = rule(
      ".landing-turnover-care .turnover-intro-nav .turnover-nav-cta",
      mobile,
    );
    expect(mobileNavCta).toMatch(/min-height:\s*42px/i);
    expect(mobileNavCta).toMatch(/padding-inline:\s*16px/i);
    expect(
      rule(".landing-turnover-care .turnover-intro-hero", mobile),
    ).toMatch(/border-radius:\s*28px/i);
    const mobileHeroImage = rule(
      ".landing-turnover-care .turnover-intro-hero > img",
      mobile,
    );
    expect(mobileHeroImage).toMatch(/height:\s*48%/i);
    expect(mobileHeroImage).toMatch(/object-position:\s*center\s*;/i);
    expect(
      rule(".landing-turnover-care .turnover-intro-overlay", mobile),
    ).toMatch(/background:\s*linear-gradient\(\s*180deg,/i);
    expect(
      rule(".landing-turnover-care .turnover-intro-copy h1", mobile),
    ).toMatch(/font-size:\s*39px/i);
    expect(
      rule(".landing-turnover-care .turnover-intro-meta", mobile),
    ).toMatch(/padding-top:\s*22px/i);
    expect(
      rule(".landing-turnover-care .turnover-intro-process", mobile),
    ).toMatch(/padding:\s*38px\s+0\s+66px/i);
    expect(
      rule(".landing-turnover-care .turnover-intro-process ol", mobile),
    ).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/i);
    expect(
      rule(".landing-turnover-care .turnover-intro-process li", mobile),
    ).toMatch(/padding:\s*22px\s+16px/i);
    expect(
      rule(".landing-turnover-care .turnover-mobile-sticky", mobile),
    ).toMatch(/grid-template-columns:\s*1fr/i);
    expect(
      rule(".landing-turnover-care .turnover-mobile-sticky a", mobile),
    ).toMatch(/border-radius:\s*12px/i);
    expectNoRule(
      ".landing-turnover-care .turnover-intro-header",
      mobile,
    );
    expect(
      rule(
        ".landing-turnover-care .turnover-intro-header .brand-engineering",
        tablet,
      ),
    ).toMatch(/display:\s*none/i);
    expect(
      rule(
        ".landing-turnover-care .turnover-intro-nav > a:not(.turnover-nav-cta)",
        tablet,
      ),
    ).toMatch(/display:\s*none/i);
    expect(css).toMatch(/\.landing-page\s+:where\([^}]*\):focus-visible\s*{/i);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{/i);
  });

  it("publishes route-specific metadata", () => {
    expect(metadata.title).toMatch(/24H 입·퇴실 관리/);
    expect(metadata.description).toMatch(/퇴실 14일 전/);
    expect(metadata.alternates).toEqual({ canonical: "/turnover-care" });
  });
});
