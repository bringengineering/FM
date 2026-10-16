import type { Metadata } from "next";
import CleaningEstimateWizard from "./CleaningEstimateWizard";
import "./cleaning-estimate.css";

export const metadata: Metadata = {
  title: "청소 가격·견적 신청 | 브링케어",
  description: "부가세 포함 청소가격을 확인하고 현장 추가금 없는 사전 확정견적을 신청하세요.",
};

export default function CleaningEstimatePage() { return <CleaningEstimateWizard />; }
