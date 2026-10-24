// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function rootTokens(css: string): Record<string, string> {
  const body = css.match(/:root\s*\{([^}]+)\}/u)?.[1] ?? "";
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gu)]
      .map((match) => [match[1], match[2].replace(/\s+/gu, "").toLowerCase()]),
  );
}

describe("CRM-native FIELD semantic theme", () => {
  it("matches the CRM background, surface, text, state, radius, and shadow tokens", async () => {
    const crm = rootTokens(await readFile(resolve("../desktop-crm/src/styles.css"), "utf8"));
    const field = rootTokens(await readFile(resolve("app/field/field.css"), "utf8"));

    expect(field).toMatchObject({
      "--field-crm-background": crm["--bg"],
      "--field-crm-panel": crm["--panel"],
      "--field-crm-text": crm["--text"],
      "--field-crm-muted": crm["--muted"],
      "--field-crm-line": crm["--line"],
      "--field-crm-primary": crm["--blue"],
      "--field-crm-success": crm["--green"],
      "--field-crm-warning": crm["--yellow"],
      "--field-crm-danger": crm["--red"],
      "--field-crm-radius": crm["--radius"],
      "--field-crm-shadow": crm["--shadow"],
    });
  });

  it("keeps touch targets, focus, mobile typography, and reduced motion accessible", async () => {
    const css = await readFile(resolve("app/field/field.css"), "utf8");
    expect(css).toMatch(/\.field-v2-action[^}]*min-height:\s*44px[\s\S]*?\}/u);
    expect(css).toMatch(/\.field-v2-kpi-button:focus-visible/u);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/u);
    expect(css).toMatch(/@media\s*\(max-width:\s*700px\)[\s\S]*font-size:\s*16px/u);
  });
});
