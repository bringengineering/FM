import { describe, expect, it } from "vitest";

import {
  classifyWonjuArea,
  formatManagementNumber,
} from "../../app/field/lib/management-number";

describe("automatic BRING management numbers", () => {
  it.each([
    ["강원특별자치도 원주시 무실동 1", "MUSIL"],
    ["강원특별자치도 원주시 단계동 123", "DANGYE"],
    ["강원특별자치도 원주시 반곡동 12", "BANGOK"],
    ["강원특별자치도 원주시 지정면 기업도시로 1", "JIJEONG"],
    ["강원특별자치도 원주시", "ETC"],
  ])("classifies %s as %s", (address, area) => {
    expect(classifyWonjuArea(address)).toBe(area);
  });

  it("formats the area, year, and collision-free sequence", () => {
    expect(formatManagementNumber({ area: "MUSIL", year: 2026, sequence: 1 }))
      .toBe("BR-WJ-MUSIL-26-0001");
    expect(formatManagementNumber({ area: "MUSIL", year: 2026, sequence: 10_000 }))
      .toBe("BR-WJ-MUSIL-26-10000");
  });
});
