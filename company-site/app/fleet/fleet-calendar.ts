import type { Reservation } from "./fleet-repository.client";

export type CalendarDay = {
  key: string;
  date: Date;
  dayNumber: number;
  inMonth: boolean;
  isToday: boolean;
};

const koreaDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function koreaDateKey(value: Date | string): string {
  return koreaDateFormatter.format(typeof value === "string" ? new Date(value) : value);
}

function parts(value: Date): { year: number; month: number; day: number } {
  const [year, month, day] = koreaDateKey(value).split("-").map(Number);
  return { year, month, day };
}

function koreaMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - 9 * 60 * 60 * 1000);
}

export function buildMonthGrid(month: Date, today = new Date()): CalendarDay[] {
  const target = parts(month);
  const first = koreaMidnight(target.year, target.month, 1);
  const sundayIndex = new Date(Date.UTC(target.year, target.month - 1, 1)).getUTCDay();
  const mondayOffset = (sundayIndex + 6) % 7;
  const start = new Date(first.getTime() - mondayOffset * 86_400_000);
  const todayKey = koreaDateKey(today);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getTime() + index * 86_400_000);
    const key = koreaDateKey(date);
    const value = parts(date);
    return { key, date, dayNumber: value.day, inMonth: value.year === target.year && value.month === target.month, isToday: key === todayKey };
  });
}

export function reservationsForDay(reservations: Reservation[], dayKey: string): Reservation[] {
  const dayStart = new Date(`${dayKey}T00:00:00+09:00`).getTime();
  const dayEnd = dayStart + 86_400_000;
  return reservations
    .filter(item => item.status !== "rejected" && Date.parse(item.startAt) < dayEnd && Date.parse(item.endAt) > dayStart)
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
}

export function reservationStatusCounts(reservations: Reservation[]): { approved: number; pending: number } {
  return reservations.reduce((counts, item) => {
    if (item.status === "approved") counts.approved += 1;
    if (item.status === "pending") counts.pending += 1;
    return counts;
  }, { approved: 0, pending: 0 });
}

export function validateReservationRange(startAt: string, endAt: string, now = new Date()): string | null {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "시작과 종료 시간을 확인해 주세요.";
  if (end <= start) return "종료 시간은 시작 시간보다 늦어야 합니다.";
  if (start < now.getTime()) return "과거 시간은 예약할 수 없습니다.";
  return null;
}

export function shiftMonth(value: Date, amount: number): Date {
  const target = parts(value);
  return koreaMidnight(target.year, target.month + amount, 1);
}

export function monthLabel(value: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long" }).format(value);
}
