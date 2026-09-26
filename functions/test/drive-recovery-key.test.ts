import { describe, expect, it } from "vitest";

import {
  buildDriveRecoveryKey,
  driveRecoveryRange,
} from "../src/drive/recovery-key.js";

const MEDIA_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-10T03:00:00.000Z";

describe("Drive recovery composite keys", () => {
  it("builds a sortable status/time/media key", () => {
    expect(buildDriveRecoveryKey("queued", NOW, MEDIA_ID)).toBe(
      `queued|${NOW}|${MEDIA_ID}`,
    );
    expect(buildDriveRecoveryKey("failed", NOW, MEDIA_ID)).toBe(
      `failed|${NOW}|${MEDIA_ID}`,
    );
    expect(buildDriveRecoveryKey("syncing", NOW, MEDIA_ID)).toBe(
      `syncing|${NOW}|${MEDIA_ID}`,
    );
  });

  it("provides bounded lexicographic ranges for queued and due work", () => {
    expect(driveRecoveryRange("queued")).toEqual({
      startAt: "queued|",
      endAt: "queued|\uf8ff",
    });
    expect(driveRecoveryRange("failed", NOW)).toEqual({
      startAt: "failed|",
      endAt: `failed|${NOW}|\uf8ff`,
    });
    expect(driveRecoveryRange("syncing", NOW)).toEqual({
      startAt: "syncing|",
      endAt: `syncing|${NOW}|\uf8ff`,
    });
  });

  it("rejects malformed timestamps before Date#toISOString can throw", () => {
    expect(() => buildDriveRecoveryKey(
      "failed",
      "2026-99-99T03:00:00.000Z",
      MEDIA_ID,
    )).toThrow("drive_recovery_key_invalid");
    expect(() => driveRecoveryRange(
      "syncing",
      "2026-99-99T03:00:00.000Z",
    )).toThrow("drive_recovery_key_invalid");
  });
});
