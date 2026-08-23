// @vitest-environment-options {"url":"https://bring-fm.web.app/stair-cleaning?utm_source=naver&utm_campaign=stair-launch&utm_term=%EC%9B%90%EC%A3%BC%EA%B3%84%EB%8B%A8%EC%B2%AD%EC%86%8C"}
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QuickEstimateForm from "../../app/landing/QuickEstimateForm";

const { pushRoute, submitMarketingLead } = vi.hoisted(() => ({
  pushRoute: vi.fn(),
  submitMarketingLead: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushRoute }),
}));

vi.mock("../../app/landing/marketingLeadClient", () => ({ submitMarketingLead }));

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("이름"), {
    target: { value: "김건물" },
  });
  fireEvent.change(screen.getByLabelText("연락처"), {
    target: { value: "010-1234-5678" },
  });
  fireEvent.change(screen.getByLabelText("건물 위치 또는 지역"), {
    target: { value: "원주시 단계동" },
  });
  fireEvent.change(screen.getByLabelText("건물 정보"), {
    target: { value: "4층 원룸 건물" },
  });
  fireEvent.change(screen.getByLabelText("필요한 상담 내용"), {
    target: { value: "계단과 복도 월 4회 청소가 필요합니다." },
  });
  fireEvent.change(screen.getByLabelText("문의 유형"), {
    target: { value: "building_owner" },
  });
}

describe("QuickEstimateForm", () => {
  beforeEach(() => {
    pushRoute.mockReset();
    submitMarketingLead.mockReset();
  });

  it("renders the minimum required fields and service context", () => {
    render(
      <QuickEstimateForm
        service="계단·공용부 청소"
        sourcePath="/stair-cleaning"
      />,
    );

    expect(screen.getByLabelText("이름")).toBeRequired();
    expect(screen.getByLabelText("연락처")).toBeRequired();
    expect(screen.getByLabelText("건물 위치 또는 지역")).toBeRequired();
    expect(screen.getByLabelText("필요한 상담 내용")).toBeRequired();
    expect(screen.getByLabelText("문의 유형")).toBeRequired();
    expect(screen.getByLabelText(/상담을 위해 입력 정보를/)).toBeRequired();
    expect(screen.getByLabelText("건물 정보")).not.toBeRequired();
    expect(
      screen.getByRole("heading", { name: "계단·공용부 청소 견적 신청" }),
    ).toBeInTheDocument();
  });

  it("does not submit when consent is missing", () => {
    render(
      <QuickEstimateForm
        service="입주청소"
        sourcePath="/move-in-cleaning"
      />,
    );
    fillRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "간편 견적 신청" }));

    expect(submitMarketingLead).not.toHaveBeenCalled();
  });

  it("stores the lead in CRM with service and Naver campaign context once", async () => {
    let resolveRequest!: (value: { receiptId: string }) => void;
    const request = new Promise<{ receiptId: string }>((resolve) => {
      resolveRequest = resolve;
    });
    submitMarketingLead.mockReturnValue(request);

    render(
      <QuickEstimateForm
        service="계단·공용부 청소"
        sourcePath="/stair-cleaning"
      />,
    );
    fillRequiredFields();
    fireEvent.click(screen.getByLabelText(/상담을 위해 입력 정보를/));

    const submitButton = screen.getByRole("button", {
      name: "간편 견적 신청",
    });
    fireEvent.click(submitButton);

    expect(await screen.findByRole("button", { name: "전송 중..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "전송 중..." }));
    expect(submitMarketingLead).toHaveBeenCalledTimes(1);
    expect(submitMarketingLead).toHaveBeenCalledWith(expect.objectContaining({
      name: "김건물",
      phone: "010-1234-5678",
      location: "원주시 단계동",
      needs: "계단과 복도 월 4회 청소가 필요합니다.",
      customerType: "building_owner",
      service: "계단·공용부 청소",
      sourcePath: "/stair-cleaning",
      utmSource: "naver",
      utmCampaign: "stair-launch",
      utmTerm: "원주계단청소",
      consent: true,
    }));

    resolveRequest({ receiptId: "lead_1234567890abcdef" });
    await waitFor(() =>
      expect(pushRoute).toHaveBeenCalledWith("/consult/complete?receipt=lead_1234567890abcdef"),
    );
    expect(submitMarketingLead).toHaveBeenCalledTimes(1);
  });

  it("shows a phone and copy fallback when delivery fails", async () => {
    submitMarketingLead.mockRejectedValue(new Error("CRM 접수 실패"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <QuickEstimateForm
        service="건물관리"
        sourcePath="/building-care"
      />,
    );
    fillRequiredFields();
    fireEvent.click(screen.getByLabelText(/상담을 위해 입력 정보를/));
    fireEvent.click(screen.getByRole("button", { name: "간편 견적 신청" }));

    expect(await screen.findByRole("status")).toHaveTextContent("CRM 접수 실패");
    expect(screen.getByRole("link", { name: /전화 상담/ })).toHaveAttribute(
      "href",
      "tel:01065663606",
    );

    fireEvent.click(screen.getByRole("button", { name: "신청 내용 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain("건물관리");
    expect(writeText.mock.calls[0][0]).toContain("원주시 단계동");
    expect(writeText.mock.calls[0][0]).toContain("계단과 복도 월 4회 청소");
  });
});
