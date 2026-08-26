import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ConsultCompletePage from "../../app/consult/complete/page";

describe("ConsultCompletePage", () => {
  it("confirms CRM receipt and offers verified Kakao chat immediately", () => {
    render(<ConsultCompletePage />);
    expect(screen.getByRole("heading", { name: /상담 신청이.*접수 완료/ })).toBeInTheDocument();
    expect(screen.getByText(/브링케어 CRM에 안전하게 접수/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /BRING CARE 카카오톡 바로 상담/ })).toHaveAttribute(
      "href",
      "https://pf.kakao.com/_xnaRfX/chat",
    );
    expect(screen.getByRole("link", { name: "010-6566-3603" })).toHaveAttribute(
      "href",
      "tel:01065663603",
    );
  });
});
