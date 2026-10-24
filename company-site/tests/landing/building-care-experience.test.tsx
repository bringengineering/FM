import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BuildingCareExperienceCards from "../../app/landing/BuildingCareExperienceCards";

describe("BuildingCareExperienceCards", () => {
  it("shows three evidence-based management experience cards", () => {
    render(<BuildingCareExperienceCards />);

    expect(screen.getByRole("heading", { name: "건물주가 체감하는 관리의 차이" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByText("멀리 있어도 확인이 쉬워집니다.")).toBeInTheDocument();
    expect(screen.getByText("연락할 곳을 줄여드립니다.")).toBeInTheDocument();
    expect(screen.getByText("확인에서 완료 기록까지 이어집니다.")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("does not present the experience cards as customer reviews", () => {
    render(<BuildingCareExperienceCards />);

    expect(screen.queryByText(/시안용/)).not.toBeInTheDocument();
    expect(screen.queryByText(/실제 고객/)).not.toBeInTheDocument();
    expect(screen.queryByText(/4\.9점/)).not.toBeInTheDocument();
    expect(screen.queryByText(/고객 후기/)).not.toBeInTheDocument();
  });
});
