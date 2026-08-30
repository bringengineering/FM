import type { Metadata } from "next";
import BuildingCareLanding from "../landing/BuildingCareLanding";

export const metadata: Metadata = {
  title: "원주 원룸·다가구 건물관리 | BRING CARE",
  description: "원주 원룸 관리와 원주 다가구 관리. 공실·입퇴실·시설점검·민원·수리 조율과 월간 관리보고를 한 곳에서 제공합니다.",
  alternates: { canonical: "/building-care" },
  openGraph: {
    title: "원주 원룸·다가구 건물관리 | BRING CARE",
    description: "공실부터 임차인·시설점검·민원·수리까지 건물주 대신 확인하고 처리합니다.",
    images: [],
  },
  twitter: {
    card: "summary",
    title: "원주 원룸·다가구 건물관리 | BRING CARE",
    description: "공실부터 임차인·시설점검·민원·수리까지 건물주 대신 확인하고 처리합니다.",
    images: [],
  },
};

export default function BuildingCarePage() {
  return <BuildingCareLanding />;
}
