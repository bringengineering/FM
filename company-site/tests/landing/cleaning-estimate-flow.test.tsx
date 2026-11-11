import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: ({ fill: _fill, priority: _priority, unoptimized: _unoptimized, ...props }: Record<string, unknown>) => <img {...props} alt={String(props.alt ?? "")} /> }));
vi.mock("../../app/landing/marketingLeadClient", () => ({ submitMarketingLead: vi.fn() }));

import CleaningEstimateWizard from "../../app/cleaning-estimate/CleaningEstimateWizard";

describe("cleaning estimate selection flow", () => {
  it("reveals the selected service price without repeating the service inside the form", () => {
    render(<CleaningEstimateWizard />);
    fireEvent.click(screen.getByRole("button", { name: "원룸·다가구 입주/퇴실청소 선택" }));
    expect(screen.getByRole("heading", { name: "원룸·다가구 입주/퇴실청소 가격" })).toBeVisible();
    fireEvent.click(screen.getByLabelText("7~9평 169,000원"));
    expect(screen.getByText("선택 가격 169,000원")).toBeVisible();
    expect(screen.getByRole("button", { name: "이 가격으로 견적 요청" })).toBeEnabled();
  });
});
