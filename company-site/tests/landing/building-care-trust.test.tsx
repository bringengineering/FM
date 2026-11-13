import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BuildingCareCredentials from "../../app/landing/BuildingCareCredentials";

describe("BuildingCareCredentials", () => {
  it("separates four official company confirmations from six awards and education records", () => {
    render(<BuildingCareCredentials />);

    const certifications = screen.getByRole("region", { name: "공식 기업 인증" });
    const awards = screen.getByRole("region", { name: "수상·교육 이력" });

    expect(within(certifications).getAllByRole("button")).toHaveLength(4);
    expect(within(awards).getAllByRole("button")).toHaveLength(6);
    expect(screen.getByText("연구개발전담부서 인정")).toBeInTheDocument();
    expect(screen.getByText("중소기업 확인")).toBeInTheDocument();
    expect(screen.getByText("2026 지역 창업 솔버톤 우수상")).toBeInTheDocument();
    expect(screen.getByText("원주시 창업가 양성 가속화 과정 수료")).toBeInTheDocument();
  });

  it("does not overstate company credentials as a building-management guarantee", () => {
    render(<BuildingCareCredentials />);

    expect(screen.queryByText(/건물관리 인증/)).not.toBeInTheDocument();
    expect(screen.queryByText(/품질 보장/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/기업의 연구·운영 기반을 보여주는 자료이며/),
    ).toBeInTheDocument();
  });

  it("opens and closes an accessible document preview", () => {
    render(<BuildingCareCredentials />);

    fireEvent.click(screen.getByRole("button", { name: /연구개발전담부서 인정 원본 보기/ }));
    const dialog = screen.getByRole("dialog", { name: "연구개발전담부서 인정" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: /연구개발전담부서 인정 확인서/ })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
