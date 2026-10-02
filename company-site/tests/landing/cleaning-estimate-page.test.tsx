import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => <img {...props} alt={String(props.alt ?? "")} /> }));
vi.mock("../../app/landing/marketingLeadClient", () => ({ submitMarketingLead: vi.fn() }));

import CleaningEstimateWizard from "../../app/cleaning-estimate/CleaningEstimateWizard";

describe("CleaningEstimateWizard", () => {
  it("renders the editorial conversion story and seven service choices", () => {
    render(<CleaningEstimateWizard />);
    expect(screen.getByRole("heading", { name: /청소 가격, 먼저 확인하고 신청하세요/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "내 청소가격 확인하기" })).toBeVisible();
    expect(screen.getByText("현장 추가금 없는 사전 확정견적")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /선택/ })).toHaveLength(7);
    expect(screen.getAllByTestId("promise-block")).toHaveLength(3);
    expect(screen.getAllByTestId("proof-image")).toHaveLength(4);
    expect(screen.getAllByTestId("process-step")).toHaveLength(5);
    expect(screen.getByText("예약금 20%")).toBeVisible();
  });
});
