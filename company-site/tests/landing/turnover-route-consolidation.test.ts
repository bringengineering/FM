import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("turnover-care route consolidation", () => {
  it("permanently redirects the legacy landing to the building-care turnover section", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "../firebase.json"), "utf8"),
    );

    expect(config.hosting.redirects).toContainEqual({
      source: "/turnover-care",
      destination: "/building-care#turnover-package",
      type: 301,
    });
  });
});
