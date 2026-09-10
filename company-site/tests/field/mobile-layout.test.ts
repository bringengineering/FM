// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function declaration(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("mobile field layout", () => {
  it("lets the account header and wizard actions scroll with content", async () => {
    const css = await readFile(resolve("app/field/field.css"), "utf8");

    expect(declaration(css, ".field-topbar")).not.toMatch(/position:\s*(sticky|fixed)/);
    expect(declaration(css, ".field-wizard-actions"))
      .not.toMatch(/position:\s*(sticky|fixed)/);
  });

  it("uses a compact bottom nav while preserving accessible touch targets", async () => {
    const css = await readFile(resolve("app/field/field.css"), "utf8");

    expect(css).toMatch(/--field-mobile-nav-height:\s*58px/);
    expect(declaration(css, ".field-nav-item")).toMatch(/min-height:\s*44px/);
  });
});
