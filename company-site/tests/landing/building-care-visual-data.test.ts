import { describe, expect, it } from "vitest";
import {
  activeCertifications,
  directVsBringRows,
  managementCycle,
  managementScopeRows,
  serviceVisuals,
} from "../../app/landing/buildingCareVisualData";

describe("building care visual conversion data", () => {
  it("only exposes active verified certifications", () => {
    expect(activeCertifications.map((item) => item.id)).toEqual([
      "rnd",
      "venture",
      "startup",
    ]);
    expect(activeCertifications.every((item) => item.image.endsWith(".webp"))).toBe(true);
  });

  it("keeps the approved visual service and comparison contracts", () => {
    expect(serviceVisuals).toHaveLength(6);
    expect(directVsBringRows).toHaveLength(6);
    expect(managementScopeRows.every((row) => row.included !== row.separate)).toBe(true);
    expect(managementCycle.map((item) => item.title)).toEqual([
      "확인",
      "조율",
      "처리",
      "기록",
    ]);
  });
});
