import { describe, expect, it } from "vitest";
import {
  buildingCareCases,
  buildingCareFaq,
  buildingCarePillars,
  entryServices,
  managementSteps,
  turnoverSteps,
} from "../../app/landing/buildingCareData";

describe("building care sales data", () => {
  it("keeps the approved service hierarchy and processes", () => {
    expect(buildingCarePillars.map((item) => item.id)).toEqual([
      "pm",
      "fm",
      "maintenance",
    ]);
    expect(turnoverSteps).toHaveLength(9);
    expect(managementSteps).toHaveLength(7);
    expect(buildingCareCases.every((item) => item.image.startsWith("/landing/records/"))).toBe(true);
    expect(buildingCareFaq).toHaveLength(8);
    expect(entryServices.map((item) => item.cta)).toEqual([
      "청소 견적받기",
      "입퇴실 패키지 문의하기",
    ]);
  });
});
