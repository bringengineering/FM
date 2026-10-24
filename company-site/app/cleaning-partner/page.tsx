import type { Metadata } from "next";
import PartnerApplication from "./PartnerApplication";
import "./partner.css";

export const metadata: Metadata = {
  title: "Cleaning Partner 모집 | 브링케어",
  description: "현장 추가금 없이 정직한 운영 기준을 함께 지킬 브링케어 Cleaning Partner를 모집합니다.",
};

export default function CleaningPartnerPage() { return <PartnerApplication />; }
