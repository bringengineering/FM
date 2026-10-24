import { describe, expect, it } from "vitest";
import { buildMonthGrid, koreaDateKey, reservationsForDay, reservationStatusCounts, validateReservationRange } from "../../app/fleet/fleet-calendar";
import type { Reservation } from "../../app/fleet/fleet-repository.client";

const reservation = (overrides: Partial<Reservation> = {}): Reservation => ({
  id: "r1", vehicleId: "ev4-001", userUid: "u1", driverName: "홍길동", purpose: "현장", destination: "원주",
  startAt: "2026-10-31T14:00:00.000Z", endAt: "2026-10-31T17:00:00.000Z", approvalType: "weekend", status: "pending",
  createdAt: "2026-10-25T00:00:00.000Z", updatedAt: "2026-10-25T00:00:00.000Z", ...overrides,
});

describe("fleet calendar domain", () => {
  it("builds a Monday-first six-week grid for October 2026", () => {
    const days = buildMonthGrid(new Date("2026-10-01T12:00:00+09:00"), new Date("2026-10-25T12:00:00+09:00"));
    expect(days).toHaveLength(42);
    expect(days[0].key).toBe("2026-09-28");
    expect(days[3]).toMatchObject({ key: "2026-10-01", dayNumber: 1, inMonth: true });
    expect(days.find(day => day.key === "2026-10-25")?.isToday).toBe(true);
    expect(days[41].key).toBe("2026-11-08");
  });

  it("uses Korea dates and groups an overnight reservation on both dates", () => {
    expect(koreaDateKey("2026-10-31T15:30:00.000Z")).toBe("2026-11-01");
    const overnight = reservation({ startAt: "2026-10-31T14:00:00.000Z", endAt: "2026-11-01T01:00:00.000Z" });
    expect(reservationsForDay([overnight], "2026-10-31")).toHaveLength(1);
    expect(reservationsForDay([overnight], "2026-11-01")).toHaveLength(1);
  });

  it("counts visible statuses and excludes rejected reservations", () => {
    expect(reservationStatusCounts([
      reservation({ id: "approved", status: "approved" }),
      reservation({ id: "pending", status: "pending" }),
      reservation({ id: "rejected", status: "rejected" }),
    ])).toEqual({ approved: 1, pending: 1 });
  });

  it("rejects equal, reversed and past reservation ranges", () => {
    const now = new Date("2026-10-25T00:00:00.000Z");
    expect(validateReservationRange("2026-10-26T01:00:00.000Z", "2026-10-26T01:00:00.000Z", now)).toContain("종료");
    expect(validateReservationRange("2026-10-26T02:00:00.000Z", "2026-10-26T01:00:00.000Z", now)).toContain("종료");
    expect(validateReservationRange("2026-10-24T01:00:00.000Z", "2026-10-24T02:00:00.000Z", now)).toContain("과거");
    expect(validateReservationRange("2026-10-26T01:00:00.000Z", "2026-10-26T02:00:00.000Z", now)).toBeNull();
  });
});
