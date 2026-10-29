import { describe, expect, it } from "vitest";

import {
  hasApprovedWeekendReservation,
  overlapsReservation,
  prepareTripStart,
} from "../../app/fleet/fleet-policy";

describe("prepareTripStart", () => {
  const photo = new File([new Uint8Array([1])], "odometer.jpg", { type: "image/jpeg" });

  it("trims free-text fields and accepts an explicit integer start km", () => {
    expect(prepareTripStart({ purpose: "  고객 미팅  ", destination: "  서울 본사 ", startKm: "1234", currentKm: 1234, photo })).toEqual({
      ok: true,
      value: { purpose: "고객 미팅", destination: "서울 본사", startOdometer: 1234, photo },
    });
  });

  it.each([
    [{ purpose: "   ", destination: "원주", startKm: "1200", currentKm: 1200, photo }, "운행 목적을 입력해 주세요."],
    [{ purpose: "점검", destination: "   ", startKm: "1200", currentKm: 1200, photo }, "목적지를 입력해 주세요."],
    [{ purpose: "점검", destination: "원주", startKm: "1200", currentKm: 1200 }, "출발 계기판 사진을 촬영해 주세요."],
    [{ purpose: "점검", destination: "원주", startKm: "", currentKm: 1200, photo }, "출발 km를 입력해 주세요."],
    [{ purpose: "점검", destination: "원주", startKm: "1200.5", currentKm: 1200, photo }, "출발 km는 정수로 입력해 주세요."],
    [{ purpose: "점검", destination: "원주", startKm: "천이백", currentKm: 1200, photo }, "출발 km는 정수로 입력해 주세요."],
    [{ purpose: "점검", destination: "원주", startKm: "1199", currentKm: 1200, photo }, "출발 km는 현재 km보다 작을 수 없습니다."],
  ])("rejects invalid trip input", (input, message) => {
    expect(prepareTripStart(input)).toEqual({ ok: false, message });
  });
});

describe("weekend reservation policy", () => {
  const approved = { userUid: "u1", status: "approved", startAt: "2026-10-24T22:00:00.000Z", endAt: "2026-10-25T03:00:00.000Z" };

  it("requires an approved reservation covering the weekend departure time", () => {
    expect(hasApprovedWeekendReservation([approved], "u1", new Date("2026-10-25T00:00:00.000Z"))).toBe(true);
    expect(hasApprovedWeekendReservation([{ ...approved, status: "pending" }], "u1", new Date("2026-10-25T00:00:00.000Z"))).toBe(false);
    expect(hasApprovedWeekendReservation([approved], "u2", new Date("2026-10-25T00:00:00.000Z"))).toBe(false);
  });

  it("treats touching half-open reservations as non-overlapping", () => {
    expect(overlapsReservation("2026-10-25T01:00:00.000Z", "2026-10-25T03:00:00.000Z", approved)).toBe(true);
    expect(overlapsReservation("2026-10-25T03:00:00.000Z", "2026-10-25T04:00:00.000Z", approved)).toBe(false);
  });
});
