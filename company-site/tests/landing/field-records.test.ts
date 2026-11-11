import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { landingServices } from "../../app/landing/services";

const expectedPostIds = [
  "224383896443",
  "224382176899",
  "224382176266",
  "224382175661",
  "224382174945",
  "224382174370",
  "224382173190",
  "224382172156",
  "224382169457",
  "224381122777",
  "224373338080",
  "224368259003",
];

describe("BRING CARE field record archive", () => {
  it("covers all 12 published field-record posts without duplicates", () => {
    const postIds = Object.values(landingServices)
      .flatMap((service) => service.records)
      .map((record) => record.sourceUrl.split("/").at(-1));

    expect(new Set(postIds)).toEqual(new Set(expectedPostIds));
    expect(new Set(postIds)).toHaveLength(12);
  });

  it("has a dedicated archive route and Firebase export target", () => {
    const archivePage = resolve(process.cwd(), "app/care-records/page.tsx");
    const exportScript = readFileSync(
      resolve(process.cwd(), "scripts/export-firebase.mjs"),
      "utf8",
    );

    expect(existsSync(archivePage)).toBe(true);
    expect(exportScript).toContain('pathname: "/care-records"');
  });
});
