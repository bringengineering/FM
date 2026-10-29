import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const legacyFleetAssets = [
  "FleetApp-CTJ1bM6_.js",
  "index-C1IFDU0_.css",
  "index-DWvvVpBt.js",
  "layout-segment-context-CXpeiQzn.js",
  "link-BugHlVSD.js",
  "router-B2kSTloI.js",
  "FleetApp-IrUULGyL.js",
  "index-idWAU6Pd.js",
  "layout-segment-context-DbdeEdMG.js",
  "link-BDxQf6XY.js",
  "router-DylEVgwf.js",
];

describe("fleet production compatibility", () => {
  it("retains bootstrap assets referenced by installed PWA clients", async () => {
    const checks = await Promise.allSettled(
      legacyFleetAssets.map((asset) => access(resolve("firebase-public/assets", asset))),
    );

    expect(checks.every((check) => check.status === "fulfilled")).toBe(true);
  });
});
