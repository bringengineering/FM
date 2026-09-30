import { describe, expect, it } from "vitest";
import {
  buildingCareCases,
  buildingCareFaq,
  buildingCarePillars,
  entryServices,
  managementServices,
  managementSteps,
  turnoverProcess,
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
    expect(managementServices.map((item) => item.title)).toEqual([
      "시설관리",
      "임차인 응대",
      "유지관리",
      "입·퇴실 관리",
      "공실 관리",
      "관리기록",
    ]);
    expect(turnoverProcess).toHaveLength(6);
    expect(turnoverProcess.map((item) => item.title)).toEqual([
      "퇴실 예정 파악",
      "퇴실 현장 점검",
      "청소·보수 통합 준비",
      "공실 전환·임대 준비",
      "문의·방문 일정 연계",
      "다음 입주 관리",
    ]);
    expect(managementSteps).toHaveLength(7);
    expect(buildingCareCases.every((item) => item.image.startsWith("/landing/records/"))).toBe(true);
    expect(buildingCareFaq).toHaveLength(8);
    expect(entryServices.map((item) => item.cta)).toEqual([
      "청소 견적받기",
      "입퇴실 패키지 문의하기",
    ]);
    expect(
      entryServices.find((item) => item.title.includes("입·퇴실"))?.href,
    ).toBe("#turnover-package");
  });

  it("keeps each management case evidence-based", () => {
    expect(buildingCareCases.length).toBeGreaterThanOrEqual(3);

    for (const item of buildingCareCases) {
      expect(item.problem).toBeTruthy();
      expect(item.action).toBeTruthy();
      expect(item.result).toBeTruthy();
      expect(`${item.problem} ${item.action} ${item.result}`).not.toMatch(
        /매출|계약률|공실 0일|100%/,
      );
    }
  });
});
