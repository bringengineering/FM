import { beforeEach, describe, expect, it, vi } from "vitest";

const firebase = vi.hoisted(() => ({
  auth: {
    currentUser: {
      uid: "staff-1",
      displayName: "원주 담당자",
    } as { uid: string; displayName: string | null } | null,
  },
  database: {},
  ref: vi.fn((_database: unknown, path: string) => ({ path })),
  set: vi.fn(async () => undefined),
  update: vi.fn(async () => undefined),
}));

vi.mock("../../app/field/lib/firebase.client", () => ({
  auth: firebase.auth,
  database: firebase.database,
}));

vi.mock("firebase/database", () => ({
  ref: firebase.ref,
  set: firebase.set,
  update: firebase.update,
}));

import {
  appendOwnerNoteDirect,
  archiveOwnerNoteDirect,
} from "../../app/field/lib/direct-owner-notes.client";

describe("direct owner notes", () => {
  beforeEach(() => {
    firebase.ref.mockClear();
    firebase.set.mockClear();
    firebase.update.mockClear();
    firebase.auth.currentUser = { uid: "staff-1", displayName: "원주 담당자" };
  });

  it("writes an authenticated owner note directly to the building", async () => {
    await expect(appendOwnerNoteDirect({
      buildingId: "building-1",
      localId: "note_12345678",
      body: "입실 전 건물주께 연락",
      recordedAt: "2026-08-12T01:00:00.000Z",
    }, () => "2026-08-12T01:02:00.000Z")).resolves.toMatchObject({
      id: "note_12345678",
      createdBy: "staff-1",
      createdByName: "원주 담당자",
    });

    expect(firebase.ref).toHaveBeenCalledWith(
      firebase.database,
      "fieldPlatform/ownerNotes/building-1/note_12345678",
    );
    expect(firebase.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      body: "입실 전 건물주께 연락",
      createdAt: "2026-08-12T01:02:00.000Z",
    }));
  });

  it("archives only the selected note with the authenticated actor", async () => {
    await expect(archiveOwnerNoteDirect({
      buildingId: "building-1",
      noteId: "note_12345678",
    }, () => "2026-08-12T02:00:00.000Z")).resolves.toEqual({
      archivedAt: "2026-08-12T02:00:00.000Z",
      archivedBy: "staff-1",
    });

    expect(firebase.update).toHaveBeenCalledWith(expect.anything(), {
      archivedAt: "2026-08-12T02:00:00.000Z",
      archivedBy: "staff-1",
    });
  });

  it("fails closed when there is no authenticated field user", async () => {
    firebase.auth.currentUser = null;

    await expect(appendOwnerNoteDirect({
      buildingId: "building-1",
      localId: "note_12345678",
      body: "메모",
      recordedAt: "2026-08-12T01:00:00.000Z",
    })).rejects.toThrow("field_owner_note_auth_required");
    expect(firebase.set).not.toHaveBeenCalled();
  });
});
