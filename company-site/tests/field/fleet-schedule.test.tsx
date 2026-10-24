import { fireEvent, render, screen } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import FleetCalendar from "../../app/fleet/FleetCalendar";
import FleetSchedule from "../../app/fleet/FleetSchedule";
import type { Reservation } from "../../app/fleet/fleet-repository.client";

const reservation = (overrides: Partial<Reservation> = {}): Reservation => ({
  id: "r1", vehicleId: "ev4-001", userUid: "other", driverName: "김대리", purpose: "고객 미팅", destination: "서울",
  startAt: "2026-10-31T00:00:00.000Z", endAt: "2026-10-31T03:00:00.000Z", approvalType: "weekend", status: "approved",
  createdAt: "2026-10-25T00:00:00.000Z", updatedAt: "2026-10-25T00:00:00.000Z", ...overrides,
});

describe("FleetCalendar", () => {
  it("shows a navigable 42-day month grid and reports a selected date", () => {
    const select = vi.fn();
    render(<FleetCalendar month={new Date("2026-10-01T12:00:00+09:00")} selectedKey="2026-10-25" reservations={[reservation()]} onMonthChange={()=>undefined} onSelect={select}/>);
    expect(screen.getByRole("heading", { name: "2026년 10월" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /2026년 .*일/ })).toHaveLength(42);
    expect(screen.getByRole("button", { name: "이전 달" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다음 달" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "오늘" })).toBeInTheDocument();
    expect(screen.getByText("승인 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /2026년 10월 31일/ }));
    expect(select).toHaveBeenCalledWith("2026-10-31");
  });
});

describe("FleetSchedule", () => {
  it("opens a reservation form from the selected date with weekend defaults", () => {
    render(<FleetSchedule reservations={[]} userUid="mine" role="member" busy={false} initialDate="2026-10-31" onSubmit={vi.fn()} onDecide={vi.fn()}/>);
    expect(screen.getByText("2026년 10월 31일 토요일")).toBeInTheDocument();
    expect(screen.getAllByText("예약 가능")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "이 날짜에 예약하기" }));
    expect(screen.getByLabelText("시작")).toHaveValue("2026-10-31T09:00");
    expect(screen.getByLabelText("종료")).toHaveValue("2026-10-31T18:00");
    expect(screen.getByLabelText("승인 사유")).toHaveValue("weekend");
  });

  it("shows status and my-schedule text without relying on color", () => {
    render(<FleetSchedule reservations={[reservation({ userUid: "mine" }), reservation({ id: "p2", status: "pending" })]} userUid="mine" role="member" busy={false} initialDate="2026-10-31" onSubmit={vi.fn()} onDecide={vi.fn()}/>);
    expect(screen.getByText("승인 완료")).toBeInTheDocument();
    expect(screen.getByText("승인 대기")).toBeInTheDocument();
    expect(screen.getByText("내 일정")).toBeInTheDocument();
  });

  it("validates the time range inline before submitting", () => {
    const submit = vi.fn();
    render(<FleetSchedule reservations={[]} userUid="mine" role="member" busy={false} initialDate="2026-10-31" now={new Date("2026-10-25T00:00:00.000Z")} onSubmit={submit} onDecide={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: "이 날짜에 예약하기" }));
    fireEvent.change(screen.getByLabelText("시작"), { target: { value: "2026-10-31T18:00" } });
    fireEvent.change(screen.getByLabelText("종료"), { target: { value: "2026-10-31T17:00" } });
    fireEvent.change(screen.getByLabelText("목적"), { target: { value: "현장 점검" } });
    fireEvent.change(screen.getByLabelText("목적지"), { target: { value: "원주" } });
    fireEvent.click(screen.getByRole("button", { name: "예약 신청하기" }));
    expect(screen.getByRole("alert")).toHaveTextContent("종료 시간");
    expect(submit).not.toHaveBeenCalled();
  });

  it("lets an admin decide a pending reservation in the selected day", () => {
    const decide = vi.fn();
    render(<FleetSchedule reservations={[reservation({ status: "pending" })]} userUid="admin" role="admin" busy={false} initialDate="2026-10-31" onSubmit={vi.fn()} onDecide={decide}/>);
    fireEvent.click(screen.getByRole("button", { name: "김대리 예약 승인" }));
    expect(decide).toHaveBeenCalledWith("r1", "approved");
  });
});

describe("fleet app schedule integration", () => {
  it("uses the calendar as the reservation entry point", async () => {
    const source = await readFile(resolve("app/fleet/FleetApp.tsx"), "utf8");
    expect(source).toContain("차량 일정표");
    expect(source).toContain("<FleetSchedule");
    expect(source).not.toContain("function ReservationForm");
    expect(source).not.toContain(">예약 신청<");
  });
});
