import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { landingServices } from "../../app/landing/services";

describe("landing service content", () => {
  it("defines the three approved services in navigation order", () => {
    expect(Object.keys(landingServices)).toEqual([
      "stair-cleaning",
      "building-care",
      "move-in-cleaning",
    ]);

    expect(landingServices["stair-cleaning"].price).toContain("6만원");
    expect(landingServices["building-care"].price).toContain("8.9만원");
    expect(landingServices["move-in-cleaning"].price).toContain("10만원");
  });

  it("keeps service claims grounded and useful for prospective customers", () => {
    for (const [key, service] of Object.entries(landingServices)) {
      expect(service.slug).toBe(key);
      expect(service.title).not.toMatch(/1위|100%|최우수/);
      expect(service.facts).toHaveLength(4);
      expect(service.scope.length).toBeGreaterThanOrEqual(4);
      expect(service.faq.length).toBeGreaterThanOrEqual(3);

      for (const record of service.records) {
        expect(record.sourceUrl).toMatch(/^https:\/\/blog\.naver\.com\/bringcare\//);
        expect(record.alt.length).toBeGreaterThan(8);
      }
    }

    expect(landingServices["building-care"].records.length).toBeGreaterThanOrEqual(3);
    expect(Object.values(landingServices).flatMap((service) => service.records).length).toBeGreaterThanOrEqual(5);
  });

  it("uses full-size assets for landing heroes and field records", async () => {
    const images = new Set(
      Object.values(landingServices).flatMap((service) => [
        service.heroImage,
        ...service.records.map((record) => record.image),
      ]),
    );

    for (const image of images) {
      const metadata = await sharp(resolve(process.cwd(), "public", image.slice(1))).metadata();
      expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeGreaterThanOrEqual(640);
    }
  });
});
