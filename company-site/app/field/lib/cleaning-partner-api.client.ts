import { auth } from "./firebase.client";
import { getFieldAppCheckToken } from "./firebase.client";

export type PartnerOfferStatus = "offered" | "accepted" | "declined" | "expired" | "reassigned";
export interface PartnerOffer {
  id: string;
  orderId: string;
  vendorId: string;
  serviceType: string;
  region: string;
  desiredDate: string;
  supplierAmount: number;
  expiresAt: string;
  status: PartnerOfferStatus;
  revision: number;
  createdAt: string;
  respondedAt: string;
  declineReason: string;
  progress: "accepted" | "departed" | "arrived" | "started" | "photos_submitted" | "completed";
}

export interface PartnerReworkRequest {
  requestId: string;
  orderId: string;
  vendorId: string;
  complaintTitle: string;
  complaintDetail: string;
  areas: string[];
  desiredAt: string;
  partnerNote: string;
  status: "requested" | "accepted" | "declined" | "in_progress" | "awaiting_review";
  revision: number;
  declineReason: string;
  customerPhotoCount: number;
}

const API_URL = "https://asia-northeast3-bring-fm.cloudfunctions.net/cleaningPartnerApi";

async function request<T>(method: "GET" | "POST", body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error("cleaning_partner_auth_required");
  const [idToken, appCheckToken] = await Promise.all([user.getIdToken(), getFieldAppCheckToken()]);
  const response = await fetch(API_URL, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "X-Firebase-AppCheck": appCheckToken,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json() as { ok?: boolean; result?: T; error?: { code?: string } };
  if (!response.ok || payload.ok !== true || payload.result === undefined) {
    throw new Error(payload.error?.code || "cleaning_partner_request_failed");
  }
  return payload.result;
}

export async function loadPartnerOffers(): Promise<{ vendorId: string; offers: PartnerOffer[]; reworkRequests?: PartnerReworkRequest[] }> {
  const result = await request<{ vendorId: string; offers: PartnerOffer[]; reworkRequests?: PartnerReworkRequest[] }>("GET");
  return { ...result, reworkRequests: Array.isArray(result.reworkRequests) ? result.reworkRequests : [] };
}

export async function respondToCleaningRework(input: {
  orderId: string; requestId: string; expectedRevision: number; action: "accept" | "decline"; reason: string;
}): Promise<{ requestId: string; revision: number; status: string }> {
  return request("POST", { action: "rework-response", input });
}

export async function advanceCleaningRework(input: {
  orderId: string; requestId: string; expectedRevision: number; nextStatus: "in_progress" | "awaiting_review";
}): Promise<{ requestId: string; revision: number; status: string }> {
  return request("POST", { action: "rework-progress", input });
}

export async function loadCleaningReworkPhoto(input: { orderId: string; requestId: string; photoIndex: number }): Promise<{ mimeType: string; base64: string }> {
  return request("POST", { action: "rework-photo", input });
}

export async function respondToPartnerOffer(input: {
  offerId: string;
  action: "accept" | "decline";
  reason: string;
}): Promise<{ orderId: string; revision: number }> {
  return request("POST", { action: input.action, input });
}

export async function advancePartnerProgress(input: {
  offerId: string;
  nextProgress: "departed" | "arrived" | "started";
  expectedRevision: number;
}): Promise<{ orderId: string; revision: number; progress: string }> {
  return request("POST", { action: "progress", input });
}
