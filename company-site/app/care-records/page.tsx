import type { Metadata } from "next";
import FieldRecordArchive from "../landing/FieldRecordArchive";

export const metadata: Metadata = {
  title: "BRING CARE 현장기록 12건 | 원주 건물관리",
  description:
    "원주 원룸·다가구 건물의 공용부 개선, 환경 정비, 안전·하자 점검, 공실·임대 관리 실제 현장기록 12건을 확인하세요.",
};

export default function CareRecordsPage() {
  return <FieldRecordArchive />;
}
