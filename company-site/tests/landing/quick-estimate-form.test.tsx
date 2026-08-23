// @vitest-environment-options {"url":"https://bring-fm.web.app/stair-cleaning?utm_source=naver&utm_campaign=stair-launch&utm_term=%EC%9B%90%EC%A3%BC%EA%B3%84%EB%8B%A8%EC%B2%AD%EC%86%8C"}
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QuickEstimateForm from "../../app/landing/QuickEstimateForm";

const { pushRoute } = vi.hoisted(() => ({ pushRoute: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushRoute }),
}));

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
}

function successResponse() {
  return Promise.resolve({
    ok: true,
    json: async () => ({ success: true }),
  } as Response);
}

describe("QuickEstimateForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    pushRoute.mockReset();
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

    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends service, page and Naver campaign context once while submitting", async () => {
    let resolveRequest!: (response: Response) => void;
    const request = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    vi.mocked(fetch).mockReturnValue(request);

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
    expect(fetch).toHaveBeenCalledTimes(1);

    const [endpoint, options] = vi.mocked(fetch).mock.calls[0];
    expect(endpoint).toBe(
      "https://formsubmit.co/ajax/bringengineering1008@gmail.com",
    );
    const delivery = options?.body as FormData;
    expect(delivery.get("서비스")).toBe("계단·공용부 청소");
    expect(delivery.get("유입 경로")).toBe("/stair-cleaning");
    expect(delivery.get("현재 URL")).toContain(
      "https://bring-fm.web.app/stair-cleaning",
    );
    expect(delivery.get("utm_source")).toBe("naver");
    expect(delivery.get("utm_campaign")).toBe("stair-launch");
    expect(delivery.get("utm_term")).toBe("원주계단청소");
    expect(delivery.get("접수 시각")).toBeTruthy();

    resolveRequest(await successResponse());
    await waitFor(() =>
      expect(pushRoute).toHaveBeenCalledWith("/consult/complete"),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows a phone and copy fallback when delivery fails", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, message: "전송 실패" }),
    } as Response);
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

    expect(await screen.findByRole("status")).toHaveTextContent("전송 실패");
    expect(screen.getByRole("link", { name: /전화 상담/ })).toHaveAttribute(
      "href",
      "tel:01065663606",
    );

    fireEvent.click(screen.getByRole("button", { name: "신청 내용 복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain("건물관리");
    expect(writeText.mock.calls[0][0]).toContain("원주시 단계동");
  });
});
