"use strict";

function buildAugustOneOffPatch(now = new Date().toISOString()) {
  const customerId = "cus_msw117cqgmca";
  const buildingId = "building_bukwon_2475_93";
  return {
    "contracts/ctr_bukwon_grounds_20260815": {
      id: "ctr_bukwon_grounds_20260815", contractNo: "CT-20260815-0001", types: ["건물관리"], type: "건물관리", name: "예초 작업",
      customerId, buildingId, startDate: "2026-08-15", endDate: "2026-08-15", workDate: "2026-08-15", paymentDueDate: "2026-08-15",
      amount: 150000, vendorCost: 140000, grossProfit: 10000, billingCycle: "건별", collectionStatus: "입금 완료", vendorPaymentStatus: "지급 완료",
      status: "종료", owner: "서창환", scope: "건물 외부 수목·벽면·통행로 주변 예초 및 정리", serviceRecordId: "service_drive_1cS3-f7JM4mrs6p321r7bftYrGF4qyIPK",
      serviceFrequency: "1회", unitCount: 0, managementTarget: "", feeMethod: "단건", memo: "고객 입금 150,000원 / 사계절제초작업 지급 140,000원", createdAt: "2026-08-15T09:00:00+09:00", updatedAt: now
    },
    "contracts/ctr_bukwon_waste_20260827": {
      id: "ctr_bukwon_waste_20260827", contractNo: "CT-20260827-0001", types: ["청소"], type: "청소", name: "예초집 폐기물 처리",
      customerId, buildingId, startDate: "2026-08-27", endDate: "2026-08-27", workDate: "2026-08-27", paymentDueDate: "2026-08-27",
      amount: 35000, vendorCost: 32000, grossProfit: 3000, billingCycle: "건별", collectionStatus: "입금 예정", vendorPaymentStatus: "지급 완료",
      status: "진행 중", owner: "서창환", scope: "예초집 폐기물 수거·처리", serviceRecordId: "service_bukwon_waste_20260827",
      serviceFrequency: "1회", unitCount: 0, managementTarget: "", feeMethod: "단건", memo: "작업비 32,000원 / 고객 청구 예정 35,000원", createdAt: now, updatedAt: now
    }
  };
}

module.exports = { buildAugustOneOffPatch };
