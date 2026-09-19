import { describe, expect, it } from "vitest";

import {
  CAPTURE_ZONES,
  MEDIA_POLICY,
  buildStagingPath,
  describeCaptureFile,
  evaluateVerticalVideo,
  isSafeCaptureId,
  isSafePathSegment,
  isUuidV4,
} from "../../app/field/lib/capture-policy";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const MEDIA_ID = "22222222-2222-4222-8222-222222222222";
const CAPTURED_AT = "2026-08-10T03:00:00.000Z";

function captureFile(
  overrides: Partial<{ name: string; type: string; size: number; lastModified: number }> = {},
) {
  return {
    name: "outside.jpg",
    type: "image/jpeg",
    size: 1_024,
    lastModified: 100,
    ...overrides,
  };
}

function descriptorInput(overrides: Partial<{
  mediaId: string;
  captureSessionId: string;
  zone: "exterior" | "verticalVideo";
  slotId: string;
  required: boolean;
}> = {}) {
  return {
    mediaId: MEDIA_ID,
    captureSessionId: SESSION_ID,
    zone: "exterior" as const,
    slotId: "exterior-1",
    required: true,
    ...overrides,
  };
}

describe("capture zone policy", () => {
  it("locks the 14-zone order, Korean labels, media kinds, and required defaults", () => {
    expect(CAPTURE_ZONES.map(({ id, label, kind, required, minimum }) => ({
      id,
      label,
      kind,
      required,
      minimum,
    }))).toEqual([
      { id: "exterior", label: "외관", kind: "photo", required: true, minimum: 1 },
      { id: "accessRoad", label: "도로·진입부", kind: "photo", required: true, minimum: 1 },
      { id: "parking", label: "주차", kind: "photo", required: false, minimum: 1 },
      { id: "commonEntrance", label: "공동현관", kind: "photo", required: true, minimum: 1 },
      { id: "corridorStairs", label: "복도·계단", kind: "photo", required: false, minimum: 1 },
      { id: "recycling", label: "분리수거장", kind: "photo", required: false, minimum: 1 },
      { id: "roomOverview", label: "전체구조", kind: "photo", required: true, minimum: 2 },
      { id: "windowDaylight", label: "창문·채광", kind: "photo", required: true, minimum: 1 },
      { id: "kitchen", label: "주방", kind: "photo", required: true, minimum: 1 },
      { id: "bathroom", label: "욕실", kind: "photo", required: true, minimum: 1 },
      { id: "optionsStorage", label: "옵션·수납", kind: "photo", required: false, minimum: 1 },
      { id: "boilerEquipment", label: "보일러·설비", kind: "photo", required: true, minimum: 1 },
      { id: "repairEvidence", label: "수리 필요부분", kind: "photo", required: false, minimum: 1 },
      { id: "verticalVideo", label: "10~20초 세로영상", kind: "video", required: true, minimum: 1 },
    ]);
  });
});

describe("capture file policy", () => {
  it("defines exactly eight MIME mappings and the approved byte limits", () => {
    expect(MEDIA_POLICY).toEqual({
      photo: {
        maxBytes: 25 * 1_024 * 1_024,
        mimeToExtension: {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
          "image/heic": "heic",
          "image/heif": "heif",
        },
      },
      video: {
        maxBytes: 500 * 1_024 * 1_024,
        mimeToExtension: {
          "video/mp4": "mp4",
          "video/quicktime": "mov",
          "video/webm": "webm",
        },
      },
    });
  });

  it.each([
    ["image/jpeg", "photo", "jpg", "exterior"],
    ["image/png", "photo", "png", "exterior"],
    ["image/webp", "photo", "webp", "exterior"],
    ["image/heic", "photo", "heic", "exterior"],
    ["image/heif", "photo", "heif", "exterior"],
    ["video/mp4", "video", "mp4", "verticalVideo"],
    ["video/quicktime", "video", "mov", "verticalVideo"],
    ["video/webm", "video", "webm", "verticalVideo"],
  ] as const)("derives %s metadata and a deterministic extension", (
    mimeType,
    kind,
    extension,
    zone,
  ) => {
    const descriptor = describeCaptureFile(
      captureFile({ name: "user-controlled.anything", type: mimeType }),
      descriptorInput({ zone, slotId: `${zone}-1` }),
      () => CAPTURED_AT,
    );

    expect(descriptor).toMatchObject({
      mediaId: MEDIA_ID,
      captureSessionId: SESSION_ID,
      kind,
      zone,
      mimeType,
      capturedAt: CAPTURED_AT,
      uploadState: "queued",
      uploadProgress: 0,
    });
    expect(buildStagingPath("staff-1", descriptor)).toBe(
      `field-media/staff-1/${SESSION_ID}/${kind === "photo" ? "photos" : "videos"}/${MEDIA_ID}.${extension}`,
    );
  });

  it.each([
    ["SVG", captureFile({ name: "vector.svg", type: "image/svg+xml" }), "capture_mime_not_allowed"],
    ["missing MIME", captureFile({ type: "" }), "capture_mime_not_allowed"],
    ["blank name", captureFile({ name: "  " }), "capture_file_name_invalid"],
    ["path name", captureFile({ name: "../outside.jpg" }), "capture_file_name_invalid"],
    ["empty", captureFile({ size: 0 }), "capture_file_empty"],
    ["negative size", captureFile({ size: -1 }), "capture_file_size_invalid"],
    ["fractional size", captureFile({ size: 1.5 }), "capture_file_size_invalid"],
    ["photo over limit", captureFile({ size: 25 * 1_024 * 1_024 + 1 }), "capture_file_too_large"],
  ])("rejects an invalid %s file before making a descriptor", (_label, file, code) => {
    expect(() => describeCaptureFile(
      file,
      descriptorInput(),
      () => CAPTURED_AT,
    )).toThrow(code);
  });

  it("rejects over-limit video and a MIME kind that does not match its zone", () => {
    expect(() => describeCaptureFile(
      captureFile({ name: "room.mp4", type: "video/mp4", size: 500 * 1_024 * 1_024 + 1 }),
      descriptorInput({ zone: "verticalVideo", slotId: "verticalVideo-1" }),
    )).toThrow("capture_file_too_large");
    expect(() => describeCaptureFile(
      captureFile({ name: "room.mp4", type: "video/mp4" }),
      descriptorInput(),
    )).toThrow("capture_kind_mismatch");
    expect(() => describeCaptureFile(
      captureFile(),
      descriptorInput({ zone: "verticalVideo", slotId: "verticalVideo-1" }),
    )).toThrow("capture_kind_mismatch");
  });

  it("returns metadata only and never retains binary or transient URL values", () => {
    const file = captureFile();
    const descriptor = describeCaptureFile(file, descriptorInput(), () => CAPTURED_AT);
    const serialized = JSON.stringify(descriptor);

    expect(descriptor).not.toHaveProperty("file");
    expect(descriptor).not.toHaveProperty("blob");
    expect(serialized).not.toMatch(/blob:|data:|base64|downloadToken|signedUrl/i);
  });
});

describe("capture staging path policy", () => {
  it("accepts canonical UUIDs, distinguishes v4, and permits a safe UID segment", () => {
    expect(isSafeCaptureId(SESSION_ID)).toBe(true);
    expect(isUuidV4(SESSION_ID)).toBe(true);
    expect(isSafeCaptureId("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(true);
    expect(isUuidV4("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(false);
    expect(isSafePathSegment("staff:wonju")).toBe(true);
  });

  it.each([
    "",
    "not-a-uuid",
    "00000000-0000-0000-0000-000000000000",
    "11111111-1111-4111-c111-111111111111",
    "11111111-1111-4111-8111-11111111111/",
    "11111111-1111-4111-8111-11111111111Z",
  ])("rejects unsafe capture id %s", (value) => {
    expect(isSafeCaptureId(value)).toBe(false);
  });

  it.each(["", " staff-1", "staff/1", "staff\\1", ".", "..", "bad#uid", "bad\u0000uid"])(
    "rejects unsafe UID/path segment %s",
    (value) => expect(isSafePathSegment(value)).toBe(false),
  );

  it("never uses the original filename and rejects forged path inputs", () => {
    const descriptor = describeCaptureFile(
      captureFile({ name: "owner-secret name.jpg" }),
      descriptorInput(),
      () => CAPTURED_AT,
    );
    const path = buildStagingPath("staff-1", descriptor);

    expect(path).toBe(
      `field-media/staff-1/${SESSION_ID}/photos/${MEDIA_ID}.jpg`,
    );
    expect(path).not.toContain("owner-secret");
    expect(() => buildStagingPath("../staff-1", descriptor)).toThrow("capture_uid_invalid");
    expect(() => buildStagingPath("staff-1", {
      ...descriptor,
      captureSessionId: "session-1",
    })).toThrow("capture_id_invalid");
    expect(() => buildStagingPath("staff-1", {
      ...descriptor,
      kind: "video",
    })).toThrow("capture_kind_mismatch");
  });
});

describe("vertical video guidance", () => {
  it.each([10, 15, 20])("accepts a %s-second portrait video", (durationSeconds) => {
    expect(evaluateVerticalVideo({ durationSeconds, width: 1_080, height: 1_920 }))
      .toEqual({ countsAsComplete: true, warnings: [] });
  });

  it("keeps invalid media as warnings without treating it as complete", () => {
    expect(evaluateVerticalVideo({ durationSeconds: 8, width: 1_920, height: 1_080 }))
      .toEqual({
        countsAsComplete: false,
        warnings: [
          "영상은 10~20초로 촬영해 주세요.",
          "휴대전화를 세로로 들고 촬영해 주세요.",
        ],
      });
    expect(evaluateVerticalVideo({ durationSeconds: Number.NaN, width: 0, height: 0 }))
      .toEqual({
        countsAsComplete: false,
        warnings: [
          "영상은 10~20초로 촬영해 주세요.",
          "휴대전화를 세로로 들고 촬영해 주세요.",
        ],
      });
  });
});
