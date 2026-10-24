import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("fleet service worker release", () => {
  it("rotates the cache and precaches the official logo", async () => {
    const source = await readFile(resolve("public/fleet/sw.js"), "utf8");

    expect(source).toContain('bring-fleet-v2');
    expect(source).toContain('/fleet/bring-engineering-logo.svg');
    expect(source).toContain('skipWaiting');
    expect(source).toContain('clients.claim');
  });
});
