import { ref, serverTimestamp, set } from "firebase/database";
import { database, ensureFieldAppCheckToken } from "../field/lib/firebase.client";

export type MarketingLeadInput = { name: string; phone: string; location: string; needs: string; buildingInfo: string; customerType: string; service: string; sourcePath: string; utmSource: string; utmCampaign: string; utmTerm: string; consent: boolean };

function requestId() {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "") || `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `lead_${random}`;
}

export async function submitMarketingLead(input: MarketingLeadInput) {
  if (!/^010-[0-9]{4}-[0-9]{4}$/.test(input.phone)) throw new Error("연락처를 010-1234-5678 형식으로 입력해 주세요.");
  if (!input.consent) throw new Error("상담 접수를 위한 개인정보 이용에 동의해 주세요.");
  const id = requestId();
  try {
    await ensureFieldAppCheckToken();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "field_app_check_unavailable") throw error;
  }
  await set(ref(database, `crmCompany/marketingLeadInbox/${id}`), { ...input, requestId: id, submittedAt: serverTimestamp(), status: "new" });
  return { receiptId: id };
}
