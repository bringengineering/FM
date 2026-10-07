// @vitest-environment-options {"url":"https://bring-fm.web.app/turnover-care?utm_source=naver&utm_campaign=turnover&utm_term=%EC%9B%90%EC%A3%BC%EC%9E%85%ED%87%B4%EC%8B%A4%EA%B4%80%EB%A6%AC"}
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  QuickEstimateExperience,
  QuickEstimateTrigger,
} from "../../app/landing/QuickEstimateExperience";

const { pushRoute, submitMarketingLead } = vi.hoisted(() => ({
  pushRoute: vi.fn(),
  submitMarketingLead: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushRoute }),
}));

vi.mock("../../app/landing/marketingLeadClient", () => ({
  submitMarketingLead,
}));

function renderExperience() {
  return render(
    <QuickEstimateExperience
      service="24H 입·퇴실 관리"
      sourcePath="/turnover-care"
      defaultCustomerType="building_owner"
      needsPlaceholder="퇴실 예정일, 호실 위치, 필요한 준비를 적어주세요."
    >
      <QuickEstimateTrigger>30초 견적</QuickEstimateTrigger>
    </QuickEstimateExperience>,
  );
}

function openAndFill() {
  fireEvent.click(screen.getByRole("link", { name: "30초 견적" }));
  fireEvent.change(screen.getByLabelText("연락처"), {
    target: { value: "01012345678" },
  });
  fireEvent.change(screen.getByLabelText("필요한 상담 내용"), {
    target: { value: "8월 31일 퇴실 예정입니다." },
  });
  fireEvent.click(
    screen.getByLabelText(/개인정보를 BRING CARE CRM에 저장/),
  );
}

describe("QuickEstimateExperience", () => {
  beforeEach(() => {
    pushRoute.mockReset();
    submitMarketingLead.mockReset();
  });

  it("keeps the detailed-form fallback and opens one named dialog", () => {
    renderExperience();
    const trigger = screen.getByRole("link", { name: "30초 견적" });

    expect(trigger).toHaveAttribute("href", "#quick-estimate");
    fireEvent.click(trigger);

    expect(
      screen.getByRole("dialog", { name: "24H 입·퇴실 관리 빠른 견적" }),
    ).toBeVisible();
    expect(screen.getByLabelText("연락처")).toHaveFocus();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("closes with Escape and returns focus to the opener", async () => {
    renderExperience();
    const trigger = screen.getByRole("link", { name: "30초 견적" });
    fireEvent.click(trigger);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes with the close button and backdrop", async () => {
    const { container } = renderExperience();
    const trigger = screen.getByRole("link", { name: "30초 견적" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "빠른 견적 닫기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    fireEvent.mouseDown(container.querySelector(".quick-estimate-backdrop") as Element);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("submits minimum fields with service, source, defaults, and UTM once", async () => {
    let resolveLead!: (value: { receiptId: string }) => void;
    submitMarketingLead.mockReturnValue(
      new Promise((resolve) => {
        resolveLead = resolve;
      }),
    );
    renderExperience();
    openAndFill();

    fireEvent.click(screen.getByRole("button", { name: "빠른 견적 신청" }));

    expect(submitMarketingLead).toHaveBeenCalledTimes(1);
    expect(submitMarketingLead).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "",
        phone: "010-1234-5678",
        location: "",
        needs: "8월 31일 퇴실 예정입니다.",
        buildingInfo: "",
        customerType: "building_owner",
        service: "24H 입·퇴실 관리",
        sourcePath: "/turnover-care",
        utmSource: "naver",
        utmCampaign: "turnover",
        utmTerm: "원주입퇴실관리",
        consent: true,
      }),
    );
    expect(screen.getByRole("button", { name: "전송 중..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "전송 중..." }));
    expect(submitMarketingLead).toHaveBeenCalledTimes(1);

    resolveLead({ receiptId: "lead_quick" });
    await waitFor(() =>
      expect(pushRoute).toHaveBeenCalledWith(
        "/consult/complete?receipt=lead_quick",
      ),
    );
  });

  it("does not submit invalid or unconsented input", () => {
    renderExperience();
    fireEvent.click(screen.getByRole("link", { name: "30초 견적" }));
    fireEvent.change(screen.getByLabelText("연락처"), {
      target: { value: "010-12" },
    });
    fireEvent.change(screen.getByLabelText("필요한 상담 내용"), {
      target: { value: "상담이 필요합니다." },
    });
    fireEvent.click(screen.getByRole("button", { name: "빠른 견적 신청" }));
    expect(submitMarketingLead).not.toHaveBeenCalled();
  });

  it("keeps the draft and offers phone, copy, and retry after an error", async () => {
    submitMarketingLead.mockRejectedValueOnce(new Error("CRM 접수 실패"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderExperience();
    openAndFill();

    fireEvent.click(screen.getByRole("button", { name: "빠른 견적 신청" }));

    expect(await screen.findByRole("status")).toHaveTextContent("CRM 접수 실패");
    expect(screen.getByLabelText("연락처")).toHaveValue("010-1234-5678");
    expect(screen.getByLabelText("필요한 상담 내용")).toHaveValue(
      "8월 31일 퇴실 예정입니다.",
    );
    expect(screen.getByRole("link", { name: /전화 상담/ })).toHaveAttribute(
      "href",
      "tel:01065663603",
    );
    fireEvent.click(screen.getByRole("button", { name: "신청 내용 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "다시 제출" })).toBeEnabled();
  });

  it("uses a centered desktop dialog and a mobile bottom sheet", () => {
    const css = readFileSync(
      resolve(process.cwd(), "app/landing/landing.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.quick-estimate-backdrop\s*\{[\s\S]*?position:\s*fixed[\s\S]*?place-items:\s*center/,
    );
    expect(css).toMatch(
      /\.quick-estimate-dialog\s*\{[\s\S]*?max-height:\s*calc\(100dvh - 48px\)[\s\S]*?overflow-y:\s*auto/,
    );
    expect(css).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.quick-estimate-backdrop\s*\{[\s\S]*?align-items:\s*end/,
    );
    expect(css).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.quick-estimate-floating\s*\{[\s\S]*?display:\s*none/,
    );
  });
});
