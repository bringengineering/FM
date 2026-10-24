import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { landingServices } from "../../app/landing/services";

describe("landing service content", () => {
  it("defines the four approved services in navigation order", () => {
    expect(Object.keys(landingServices)).toEqual([
      "stair-cleaning",
      "building-care",
      "move-in-cleaning",
      "turnover-care",
    ]);

    expect(landingServices["stair-cleaning"].price).toContain("6만원");
    expect(landingServices["building-care"].price).toContain("8만 9천원");
    expect(landingServices["move-in-cleaning"].price).toContain("10만원");
    expect(landingServices["turnover-care"].price).toContain("10만원");
  });

  it("keeps service claims grounded and useful for prospective customers", () => {
    for (const [key, service] of Object.entries(landingServices)) {
      expect(service.slug).toBe(key);
      expect(service.title).not.toMatch(/1위|100%|최우수/);
      expect(service.facts).toHaveLength(4);
      expect(service.scope.length).toBeGreaterThanOrEqual(4);
      expect(service.faq.length).toBeGreaterThanOrEqual(3);
      expect(service.records.length).toBeGreaterThanOrEqual(1);

      for (const record of service.records) {
        expect(record.sourceUrl).toMatch(/^https:\/\/blog\.naver\.com\/bringcare\//);
        expect(record.alt.length).toBeGreaterThan(8);
      }
    }

    expect(landingServices["building-care"].records.length).toBeGreaterThanOrEqual(3);
    expect(Object.values(landingServices).flatMap((service) => service.records).length).toBeGreaterThanOrEqual(5);
    expect(
      Object.values(landingServices).flatMap((service) => service.records.map((record) => record.sourceUrl)),
    ).toEqual(expect.arrayContaining([
      "https://blog.naver.com/bringcare/224382174370",
      "https://blog.naver.com/bringcare/224383896443",
      "https://blog.naver.com/bringcare/224382176899",
      "https://blog.naver.com/bringcare/224382176266",
      "https://blog.naver.com/bringcare/224368259003",
    ]));
  });

  it("uses full-size optimized assets for landing heroes and field records", async () => {
    const images = new Set(
      Object.values(landingServices).flatMap((service) => [
        service.heroImage,
        ...service.records.map((record) => record.image),
      ]),
    );

    for (const image of images) {
      const filePath = resolve(process.cwd(), "public", image.slice(1));
      const [metadata, file] = await Promise.all([
        sharp(filePath).metadata(),
        stat(filePath),
        sharp(filePath).toBuffer(),
      ]);
      expect(metadata.width).toBeGreaterThanOrEqual(640);
      expect(metadata.height).toBeGreaterThanOrEqual(640);
      expect(file.size).toBeLessThanOrEqual(400 * 1024);
    }
  });

  it("promises move-in cleaning scope and completion photos without unsupported before-and-after claims", () => {
    const service = landingServices["move-in-cleaning"];

    expect(service.accent).toBe("작업 범위와 완료 사진으로 확인하세요.");
    expect(service.metaDescription).toBe(
      "원주 원룸 입주청소 10만원부터. 작업 범위를 먼저 안내하고 완료 사진으로 확인합니다.",
    );
    expect(service.facts).toContainEqual({ value: "완료 사진", label: "작업 결과 확인" });
    expect(JSON.stringify(service)).not.toContain("전후 사진");
  });
});
