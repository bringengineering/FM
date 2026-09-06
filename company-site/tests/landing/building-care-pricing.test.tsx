import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BuildingCarePage from "../../app/building-care/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("BuildingCarePage pricing", () => {
  it("separates building management from monthly common-area cleaning", () => {
    render(<BuildingCarePage />);

    expect(screen.getByText("월 69,000원부터")).toBeInTheDocument();
    expect(screen.getByText("주 2회 정기 방문")).toBeInTheDocument();
    expect(screen.getByText("월 4회 정기청소")).toBeInTheDocument();
    expect(screen.getByText("3층 60,000원")).toBeInTheDocument();
    expect(screen.getByText("4층 70,000원")).toBeInTheDocument();
    expect(screen.getByText("5층 80,000원")).toBeInTheDocument();
    expect(screen.queryByText("월 89,000원부터")).not.toBeInTheDocument();
  });

  it("shows the separate turnover-cleaning and professional-work terms", () => {
    render(<BuildingCarePage />);

    expect(screen.getByText("관리 건물 100,000원부터")).toBeInTheDocument();
    expect(screen.getByText("일반 청소 120,000원부터")).toBeInTheDocument();
    expect(screen.getByText("승인 작업금액의 5%")).toBeInTheDocument();
    expect(screen.getAllByText("부가세 별도").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/건물관리비와 청소·수리 비용은 별도로 구분/)).toBeInTheDocument();
  });
});
