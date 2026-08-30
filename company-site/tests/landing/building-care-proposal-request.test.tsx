// @vitest-environment-options {"url":"https://bring-fm.web.app/building-care?utm_source=naver&utm_campaign=building-proposal&utm_term=%EC%9B%90%EC%A3%BC%EA%B1%B4%EB%AC%BC%EA%B4%80%EB%A6%AC"}
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BuildingCareProposalRequest from "../../app/landing/BuildingCareProposalRequest";

const { submitMarketingLead } = vi.hoisted(() => ({
  submitMarketingLead: vi.fn(),
}));

vi.mock("../../app/landing/marketingLeadClient", () => ({ submitMarketingLead }));

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("이름"), {
    target: { value: "김건물" },
  });
  fireEvent.change(screen.getByLabelText("연락처"), {
    target: { value: "010-1234-5678" },
  });
  fireEvent.change(screen.getByLabelText("건물 주소"), {
    target: { value: "원주시 단계동 123" },
  });
}

describe("BuildingCareProposalRequest", () => {
  beforeEach(() => {
    submitMarketingLead.mockReset();
  });

  it("renders the required proposal request fields", () => {
    render(<BuildingCareProposalRequest />);

    expect(screen.getByLabelText("이름")).toBeRequired();
    expect(screen.getByLabelText("연락처")).toBeRequired();
    expect(screen.getByLabelText("건물 주소")).toBeRequired();
    expect(screen.getByLabelText(/제안서 제공과 상담을 위해/)).toBeRequired();
    expect(
      screen.getByRole("heading", { name: "건물관리 제안서를 받아보세요" }),
    ).toBeInTheDocument();
  });

  it("does not submit or reveal the PDF without consent", () => {
    render(<BuildingCareProposalRequest />);
    fillRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "제안서 신청하기" }));

    expect(submitMarketingLead).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("link", { name: "제안서 PDF 다운로드" }),
    ).not.toBeInTheDocument();
  });

  it("stores one CRM lead with campaign context and reveals the PDF after success", async () => {
    let resolveRequest!: (value: { receiptId: string }) => void;
    submitMarketingLead.mockReturnValue(
      new Promise<{ receiptId: string }>((resolve) => {
        resolveRequest = resolve;
      }),
    );

    render(<BuildingCareProposalRequest />);
    fillRequiredFields();
    fireEvent.click(screen.getByLabelText(/제안서 제공과 상담을 위해/));
    fireEvent.click(screen.getByRole("button", { name: "제안서 신청하기" }));

    expect(await screen.findByRole("button", { name: "신청 중..." })).toBeDisabled();
    expect(submitMarketingLead).toHaveBeenCalledTimes(1);
    expect(submitMarketingLead).toHaveBeenCalledWith({
      name: "김건물",
      phone: "010-1234-5678",
      location: "원주시 단계동 123",
      needs: "BRING CARE 건물관리 제안서 요청",
      buildingInfo: "",
      customerType: "building_owner",
      service: "건물관리 제안서 요청",
      sourcePath: "/building-care#building-care-proposal",
      utmSource: "naver",
      utmCampaign: "building-proposal",
      utmTerm: "원주건물관리",
      consent: true,
    });
    expect(
      screen.queryByRole("link", { name: "제안서 PDF 다운로드" }),
    ).not.toBeInTheDocument();

    resolveRequest({ receiptId: "lead_proposal_123456" });

    const download = await screen.findByRole("link", {
      name: "제안서 PDF 다운로드",
    });
    expect(download).toHaveAttribute(
      "href",
      "/downloads/bring-care-building-management-proposal.pdf",
    );
    expect(download).toHaveAttribute("download", "BRING_CARE_건물관리_제안서.pdf");
    expect(submitMarketingLead).toHaveBeenCalledTimes(1);
  });

  it("shows the phone and copy fallback when CRM delivery fails", async () => {
    submitMarketingLead.mockRejectedValue(new Error("CRM 접수 실패"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<BuildingCareProposalRequest />);
    fillRequiredFields();
    fireEvent.click(screen.getByLabelText(/제안서 제공과 상담을 위해/));
    fireEvent.click(screen.getByRole("button", { name: "제안서 신청하기" }));

    expect(await screen.findByRole("status")).toHaveTextContent("CRM 접수 실패");
    expect(screen.getByRole("link", { name: /전화 상담/ })).toHaveAttribute(
      "href",
      "tel:01065663603",
    );
    expect(
      screen.queryByRole("link", { name: "제안서 PDF 다운로드" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "신청 내용 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain("건물관리 제안서 요청");
    expect(writeText.mock.calls[0][0]).toContain("원주시 단계동 123");
  });
});
