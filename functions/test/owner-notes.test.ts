import { describe, expect, it, vi } from "vitest";

import {
  appendOwnerNoteCore,
  archiveOwnerNoteCore,
  buildOwnerNoteRecord,
  normalizeOwnerNoteDrafts,
  type OwnerNoteDependencies,
  type OwnerNoteRecord,
} from "../src/field/owner-notes.js";

const NOW = "2026-08-09T02:00:00.000Z";
const actor = {
  uid: "staff-1",
  role: "staff" as const,
  tokenDisplayName: "토큰 이름",
  sessionId: "session-1",
};

function note(overrides: Partial<OwnerNoteRecord> = {}): OwnerNoteRecord {
  return {
    id: "note_12345678",
    buildingId: "building-1",
    body: "보일러 확인",
    recordedAt: NOW,
    createdAt: NOW,
    createdBy: "staff-1",
    createdByName: "서버 프로필 이름",
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<OwnerNoteDependencies> = {},
): OwnerNoteDependencies {
  return {
    nowIso: () => NOW,
    consumeRateLimit: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    buildingExists: vi.fn(async () => true),
    getUserDisplayName: vi.fn(async () => "서버 프로필 이름"),
    isAssigned: vi.fn(async () => true),
    readNote: vi.fn(async () => null),
    createNoteIfAbsent: vi.fn(async (_buildingId, _noteId, candidate) => candidate),
    archiveNote: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("owner note normalization", () => {
  it("accepts omitted drafts and trims valid drafts", () => {
    expect(normalizeOwnerNoteDrafts(undefined)).toEqual([]);
    expect(normalizeOwnerNoteDrafts([
      {
        localId: "note_12345678",
        body: "  수도 확인  ",
        recordedAt: NOW,
        ignoredClientField: "not persisted",
      },
    ])).toEqual([
      { localId: "note_12345678", body: "수도 확인", recordedAt: NOW },
    ]);
  });

  it("rejects invalid collections, empty or oversized bodies, and invalid dates", () => {
    expect(() => normalizeOwnerNoteDrafts(null)).toThrow("owner_note_drafts_invalid");
    expect(() => normalizeOwnerNoteDrafts(Array.from({ length: 101 }, (_, index) => ({
      localId: `note_${String(index).padStart(8, "0")}`,
      body: "메모",
      recordedAt: NOW,
    })))).toThrow("owner_note_drafts_invalid");
    expect(() => normalizeOwnerNoteDrafts([null])).toThrow("owner_note_draft_invalid");
    expect(() => normalizeOwnerNoteDrafts([
      { localId: "note_12345678", body: "   ", recordedAt: NOW },
    ])).toThrow("owner_note_body_required");
    expect(() => normalizeOwnerNoteDrafts([
      { localId: "note_12345678", body: "가".repeat(2001), recordedAt: NOW },
    ])).toThrow("owner_note_body_too_long");
    expect(() => normalizeOwnerNoteDrafts([
      { localId: "note_12345678", body: "메모", recordedAt: "not-a-date" },
    ])).toThrow("owner_note_recorded_at_invalid");
  });

  it("rejects duplicate or unstable IDs", () => {
    expect(() => normalizeOwnerNoteDrafts([
      { localId: "note_12345678", body: "첫 메모", recordedAt: NOW },
      { localId: "note_12345678", body: "둘째 메모", recordedAt: NOW },
    ])).toThrow("owner_note_id_duplicate");
    expect(() => normalizeOwnerNoteDrafts([
      { localId: "bad/key", body: "메모", recordedAt: NOW },
    ])).toThrow("owner_note_id_invalid");
  });
});

describe("owner note record construction", () => {
  it("uses only normalized draft data and server actor/profile/time fields", () => {
    expect(buildOwnerNoteRecord({
      buildingId: "building-1",
      draft: {
        localId: "note_12345678",
        body: " 전달사항 ",
        recordedAt: "2026-08-09T01:30:00.000Z",
        createdAt: "client-time",
        createdBy: "attacker",
        createdByName: "spoofed",
      } as never,
      actorUid: "staff-1",
      actorName: "서버 프로필 이름",
      createdAt: NOW,
    })).toEqual({
      id: "note_12345678",
      buildingId: "building-1",
      body: "전달사항",
      recordedAt: "2026-08-09T01:30:00.000Z",
      createdAt: NOW,
      createdBy: "staff-1",
      createdByName: "서버 프로필 이름",
    });
  });
});

describe("owner note append policy", () => {
  const input = {
    buildingId: "building-1",
    localId: "note_12345678",
    body: " 보일러 확인 ",
    recordedAt: NOW,
  };

  it("allows assigned staff and stamps the server profile", async () => {
    const deps = dependencies();

    await expect(appendOwnerNoteCore(input, actor, deps)).resolves.toEqual(note());
    expect(deps.isAssigned).toHaveBeenCalledWith("building-1", "staff-1");
    expect(deps.consumeRateLimit).toHaveBeenCalledWith(
      "staff-1",
      "session-1",
      "append",
      30,
    );
    expect(deps.createNoteIfAbsent).toHaveBeenCalledWith(
      "building-1",
      "note_12345678",
      note(),
    );
  });

  it("replays an identical retry without creating a second note", async () => {
    let stored: OwnerNoteRecord | null = null;
    const createNoteIfAbsent = vi.fn(async (
      _buildingId: string,
      _noteId: string,
      candidate: OwnerNoteRecord,
    ) => {
      stored ??= candidate;
      return stored;
    });
    const deps = dependencies({
      nowIso: vi.fn()
        .mockReturnValueOnce(NOW)
        .mockReturnValueOnce("2026-08-09T02:01:00.000Z"),
      readNote: vi.fn(async () => stored),
      createNoteIfAbsent,
    });

    const first = await appendOwnerNoteCore(input, actor, deps);
    const second = await appendOwnerNoteCore(input, actor, deps);

    expect(second).toEqual(first);
    expect(createNoteIfAbsent).toHaveBeenCalledOnce();
  });

  it("allows an administrator without consulting assignment", async () => {
    const deps = dependencies({ isAssigned: vi.fn(async () => false) });

    await expect(appendOwnerNoteCore(
      input,
      { uid: "admin-1", role: "admin", tokenDisplayName: "관리자" },
      deps,
    )).resolves.toMatchObject({ id: "note_12345678", createdBy: "admin-1" });
    expect(deps.isAssigned).not.toHaveBeenCalled();
  });

  it.each([
    ["disabled actor", { isEnabled: vi.fn(async () => false) }, actor, "owner_note_forbidden"],
    ["unassigned staff", { isAssigned: vi.fn(async () => false) }, actor, "owner_note_forbidden"],
    ["reviewer", {}, { ...actor, role: "reviewer" as const }, "owner_note_forbidden"],
    ["missing building", { buildingExists: vi.fn(async () => false) }, actor, "owner_note_building_not_found"],
    ["rate limit", { consumeRateLimit: vi.fn(async () => false) }, actor, "owner_note_rate_limited"],
  ])("rejects %s", async (_label, overrides, rejectedActor, code) => {
    await expect(appendOwnerNoteCore(
      input,
      rejectedActor,
      dependencies(overrides),
    )).rejects.toThrow(code);
  });

  it("rejects invalid building IDs before dependencies are called", async () => {
    const deps = dependencies();

    await expect(appendOwnerNoteCore(
      { ...input, buildingId: "bad/key" },
      actor,
      deps,
    )).rejects.toThrow("owner_note_building_id_invalid");
    expect(deps.isEnabled).not.toHaveBeenCalled();
  });

  it.each([
    ["body", { body: "different" }],
    ["recordedAt", { recordedAt: "2026-08-09T01:00:00.000Z" }],
    ["creator", { createdBy: "staff-2" }],
    ["building", { buildingId: "building-2" }],
    ["id", { id: "note_87654321" }],
  ])("rejects an existing note with mismatched immutable %s", async (_field, mismatch) => {
    const deps = dependencies({ readNote: vi.fn(async () => note(mismatch)) });

    await expect(appendOwnerNoteCore(input, actor, deps))
      .rejects.toThrow("owner_note_id_conflict");
    expect(deps.createNoteIfAbsent).not.toHaveBeenCalled();
  });

  it("detects a conflicting record returned by the atomic create dependency", async () => {
    const deps = dependencies({
      createNoteIfAbsent: vi.fn(async () => note({ body: "다른 메모" })),
    });

    await expect(appendOwnerNoteCore(input, actor, deps))
      .rejects.toThrow("owner_note_id_conflict");
  });
});

describe("owner note archive policy", () => {
  const input = { buildingId: "building-1", noteId: "note_12345678" };
  const admin = {
    uid: "admin-1",
    role: "admin" as const,
    tokenDisplayName: "관리자",
    sessionId: "admin-session",
  };

  it("allows administrators and writes only server archive metadata", async () => {
    const deps = dependencies({ readNote: vi.fn(async () => note()) });

    await expect(archiveOwnerNoteCore(input, admin, deps)).resolves.toEqual({
      archivedAt: NOW,
      archivedBy: "admin-1",
    });
    expect(deps.consumeRateLimit).toHaveBeenCalledWith(
      "admin-1",
      "admin-session",
      "archive",
      20,
    );
    expect(deps.archiveNote).toHaveBeenCalledWith(
      "building-1",
      "note_12345678",
      { archivedAt: NOW, archivedBy: "admin-1" },
    );
  });

  it("returns existing archive metadata on an idempotent retry", async () => {
    const archived = note({
      archivedAt: "2026-08-09T01:00:00.000Z",
      archivedBy: "admin-original",
    });
    const deps = dependencies({ readNote: vi.fn(async () => archived) });

    await expect(archiveOwnerNoteCore(input, admin, deps)).resolves.toEqual({
      archivedAt: archived.archivedAt,
      archivedBy: archived.archivedBy,
    });
    expect(deps.archiveNote).not.toHaveBeenCalled();
  });

  it.each([
    ["staff", actor, {}, "owner_note_archive_forbidden"],
    ["reviewer", { ...actor, role: "reviewer" as const }, {}, "owner_note_archive_forbidden"],
    ["disabled admin", admin, { isEnabled: vi.fn(async () => false) }, "owner_note_archive_forbidden"],
    ["rate limit", admin, { consumeRateLimit: vi.fn(async () => false) }, "owner_note_rate_limited"],
  ])("rejects %s", async (_label, rejectedActor, overrides, code) => {
    await expect(archiveOwnerNoteCore(
      input,
      rejectedActor,
      dependencies(overrides),
    )).rejects.toThrow(code);
  });

  it("rejects invalid IDs and missing notes", async () => {
    await expect(archiveOwnerNoteCore(
      { ...input, buildingId: "bad/key" },
      admin,
      dependencies(),
    )).rejects.toThrow("owner_note_building_id_invalid");
    await expect(archiveOwnerNoteCore(
      { ...input, noteId: "bad/key" },
      admin,
      dependencies(),
    )).rejects.toThrow("owner_note_id_invalid");
    await expect(archiveOwnerNoteCore(
      input,
      admin,
      dependencies({ readNote: vi.fn(async () => null) }),
    )).rejects.toThrow("owner_note_not_found");
  });
});
