export interface TripStartDraft {
  purpose: string;
  destination: string;
  startKm: string;
  currentKm: number;
  photo?: File;
}

export type TripStartResult =
  | { ok: true; value: { purpose: string; destination: string; startOdometer: number; photo: File } }
  | { ok: false; message: string };

export interface ReservationWindow {
  userUid: string;
  status: string;
  startAt: string;
  endAt: string;
}

export function prepareTripStart(draft: TripStartDraft): TripStartResult {
  const purpose = draft.purpose.trim();
  const destination = draft.destination.trim();
  if (!purpose) return { ok: false, message: "운행 목적을 입력해 주세요." };
  if (!destination) return { ok: false, message: "목적지를 입력해 주세요." };
  if (!draft.photo || draft.photo.size === 0) return { ok: false, message: "출발 계기판 사진을 촬영해 주세요." };
  if (draft.startKm.trim() === "") return { ok: false, message: "출발 km를 입력해 주세요." };
  const startOdometer = Number(draft.startKm);
  if (!Number.isInteger(startOdometer)) {
    return { ok: false, message: "출발 km는 정수로 입력해 주세요." };
  }
  if (startOdometer < draft.currentKm) {
    return { ok: false, message: "출발 km는 현재 km보다 작을 수 없습니다." };
  }
  return { ok: true, value: { purpose, destination, startOdometer, photo: draft.photo } };
}

export function isWeekendAt(date: Date): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short" }).format(date);
  return weekday === "Sat" || weekday === "Sun";
}

export function overlapsReservation(startAt: string, endAt: string, existing: ReservationWindow): boolean {
  return Date.parse(startAt) < Date.parse(existing.endAt) && Date.parse(existing.startAt) < Date.parse(endAt);
}

export function hasApprovedWeekendReservation(
  reservations: ReservationWindow[],
  userUid: string,
  at: Date,
): boolean {
  const point = at.getTime();
  return reservations.some((reservation) =>
    reservation.userUid === userUid
    && reservation.status === "approved"
    && Date.parse(reservation.startAt) <= point
    && point < Date.parse(reservation.endAt));
}
