import type { MediaKind, MediaZone } from "./types";

const ZONE_FOLDER_NAMES: Record<MediaZone, string> = {
  exterior: "01_외관",
  accessRoad: "02_진입로",
  parking: "03_주차",
  commonEntrance: "04_공동현관",
  corridorStairs: "05_복도·계단",
  recycling: "06_분리수거",
  roomOverview: "07_방 전체",
  windowDaylight: "08_창문·채광",
  kitchen: "09_주방",
  bathroom: "10_욕실",
  optionsStorage: "11_옵션·수납",
  boilerEquipment: "12_보일러·설비",
  repairEvidence: "13_수리 근거",
  verticalVideo: "14_세로영상",
};

export const DRIVE_ROOT_FOLDER_ID = "1A7JZQLNkuSWMrpAbVcse6EoUeUAKoN3S";

export function sanitizeDriveName(value: string, fallback = "미입력"): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 150);
  return normalized || fallback;
}

export function wonjuAreaFromAddress(address: string): string {
  const normalized = address.normalize("NFKC");
  const match = normalized.match(/원주시\s+([^\s,]+?(?:동|읍|면))(?:\s|,|$)/);
  return sanitizeDriveName(match?.[1] ?? "기타", "기타");
}

export interface DriveFolderPlanInput {
  managementNumber: string;
  buildingName: string;
  roadAddress: string;
  unitLabel?: string;
  capturedAt: string;
  captureSessionId: string;
  zone: MediaZone;
}

export function buildDriveFolderPlan(input: DriveFolderPlanInput): string[] {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(input.capturedAt)?.[0] ?? "날짜미상";
  const session = sanitizeDriveName(input.captureSessionId).slice(0, 8);
  return [
    `원주시-${wonjuAreaFromAddress(input.roadAddress)}`,
    `${sanitizeDriveName(input.managementNumber, "관리번호 미발급")}_${sanitizeDriveName(input.buildingName, "건물명 미입력")}_${sanitizeDriveName(input.roadAddress, "주소 미입력")}`,
    sanitizeDriveName(input.unitLabel ?? "건물공용", "건물공용"),
    `${day}_${session}`,
    ZONE_FOLDER_NAMES[input.zone],
  ];
}

function safeExtension(originalFileName: string, kind: MediaKind): string {
  const match = originalFileName.normalize("NFKC").match(/\.([a-zA-Z0-9]{1,8})$/);
  const extension = match?.[1]?.toLocaleLowerCase("en-US");
  if (extension && /^[a-z0-9]+$/.test(extension)) return extension;
  return kind === "video" ? "mp4" : "jpg";
}

export interface DriveMediaFileNameInput {
  zone: MediaZone;
  mediaId: string;
  kind: MediaKind;
  originalFileName: string;
}

export function buildDriveMediaFileName(input: DriveMediaFileNameInput): string {
  const id = sanitizeDriveName(input.mediaId, "media").slice(0, 8);
  return `${ZONE_FOLDER_NAMES[input.zone]}_${id}.${safeExtension(input.originalFileName, input.kind)}`;
}

export function adPackageFolderName(version: number): string {
  return `v${String(Math.max(1, Math.trunc(version))).padStart(2, "0")}`;
}
