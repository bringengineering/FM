import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PartnerApp from "../../app/partner/PartnerApp";
import type { PartnerOffer, PartnerReworkRequest } from "../../app/field/lib/cleaning-partner-api.client";

const authState = vi.hoisted(() => ({ user: null as null | { uid: string; email: string; emailVerified: boolean } }));
vi.mock("../../app/field/lib/firebase.client", () => ({ auth: {} }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, listener: (user: typeof authState.user) => void) => {
    queueMicrotask(() => listener(authState.user));
    return () => undefined;
  },
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));

const now = new Date();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const offer = (overrides: Partial<PartnerOffer> = {}): PartnerOffer => ({
  id: "8c2ac2d0-9a09-42f3-b8f8-7237562fc502", orderId: "BR-ORDER-0001", vendorId: "vendor_01",
  serviceType: "move_in_cleaning", region: "원주시", desiredDate: today, supplierAmount: 190000,
  expiresAt: "2026-09-30T00:00:00.000Z", status: "offered", revision: 1,
  createdAt: "2026-09-28T03:00:00.000Z", respondedAt: "", declineReason: "", progress: "accepted", ...overrides,
});

const rework: PartnerReworkRequest = { requestId: "5c2ac2d0-9a09-42f3-b8f8-7237562fc506", orderId: "BR-ORDER-0002", vendorId: "vendor_01",
  complaintTitle: "주방 재작업", complaintDetail: "싱크대 주변을 다시 확인해 주세요.", areas: ["kitchen"],
  desiredAt: "2026-10-01T01:00:00.000Z", partnerNote: "고객 요청 부위를 확인해 주세요.", status: "requested", revision: 1, declineReason: "", customerPhotoCount: 1 };

describe("partner app dashboard", () => {
  beforeEach(() => { authState.user = { uid: "partner_01", email: "partner@example.com", emailVerified: true }; });

  it("shows only vendor scoped offer facts and requests confirmation for new work", async () => {
    const load = vi.fn(async () => ({ vendorId: "vendor_01", offers: [offer()] }));
    const respond = vi.fn(async () => ({ orderId: "order-1", revision: 2 }));
    render(<PartnerApp api={{ load, respond }} />);
    expect(await screen.findByText("새로운 작업 제안이 도착했습니다!")).toBeInTheDocument();
    expect(document.querySelector(".partner-offer-facts")?.textContent).toContain("원주시");
    expect(screen.getByText("₩190,000")).toBeInTheDocument();
    expect(screen.queryByText(/김민수|010-1234-5678|무실로 123/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "수락" }));
    await waitFor(() => expect(respond).toHaveBeenCalledWith({ offerId: "8c2ac2d0-9a09-42f3-b8f8-7237562fc502", action: "accept", reason: "" }));
  });

  it("requires a reason before it sends a decline response", async () => {
    const load = vi.fn(async () => ({ vendorId: "vendor_01", offers: [offer()] }));
    const respond = vi.fn(async () => ({ orderId: "order-1", revision: 2 }));
    render(<PartnerApp api={{ load, respond }} />);
    fireEvent.click(await screen.findByRole("button", { name: "거절" }));
    expect(screen.getByRole("dialog", { name: "작업 제안 거절" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("거절 사유"), { target: { value: "staff_unavailable" } });
    fireEvent.click(screen.getByRole("button", { name: "거절 확정" }));
    await waitFor(() => expect(respond).toHaveBeenCalledWith({ offerId: "8c2ac2d0-9a09-42f3-b8f8-7237562fc502", action: "decline", reason: "staff_unavailable" }));
  });

  it("saves the next available work milestone with the offer revision", async () => {
    const accepted = offer({ status: "accepted", revision: 4, progress: "accepted", respondedAt: "2026-09-28T03:10:00.000Z" });
    const load = vi.fn(async () => ({ vendorId: "vendor_01", offers: [accepted] }));
    const progress = vi.fn(async () => ({ orderId: "order-1", revision: 5, progress: "departed" }));
    render(<PartnerApp api={{ load, respond: vi.fn(), progress }} />);
    fireEvent.click(await screen.findByRole("button", { name: "출발 처리" }));
    await waitFor(() => expect(progress).toHaveBeenCalledWith({ offerId: accepted.id, nextProgress: "departed", expectedRevision: 4 }));
  });

  it("shows and updates rework separately from new offers and keeps customer identity private", async () => {
    const load = vi.fn(async () => ({ vendorId: "vendor_01", offers: [], reworkRequests: [rework] }));
    const reworkRespond = vi.fn(async () => ({ requestId: rework.requestId, revision: 2, status: "accepted" }));
    const photo = vi.fn(async () => ({ mimeType: "image/jpeg", base64: "cGhvdG8=" }));
    render(<PartnerApp api={{ load, respond: vi.fn(), reworkRespond, reworkPhoto: photo }} />);
    expect(await screen.findByText("주방 재작업")).toBeInTheDocument();
    expect(screen.getByText(/고객 요청 부위를 확인해 주세요/u)).toBeInTheDocument();
    expect(screen.queryByText(/김민수|010-1234-5678|무실로 123/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "고객 문제 사진 보기 1" }));
    expect(await screen.findByRole("img", { name: "고객 문제 사진 1" })).toHaveAttribute("src", "data:image/jpeg;base64,cGhvdG8=");
    expect(photo).toHaveBeenCalledWith({ orderId: rework.orderId, requestId: rework.requestId, photoIndex: 0 });
    fireEvent.click(screen.getByRole("button", { name: "수락" }));
    await waitFor(() => expect(reworkRespond).toHaveBeenCalledWith({ orderId: rework.orderId, requestId: rework.requestId, expectedRevision: 1, action: "accept", reason: "" }));
  });
});
