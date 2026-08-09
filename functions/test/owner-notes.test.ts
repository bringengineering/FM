import { describe, expect, it, vi } from "vitest";

import {
  appendOwnerNoteCore,
  archiveOwnerNoteCore,
  buildOwnerNoteRecord,
  isStableId,
  normalizeOwnerNoteDrafts,
  resolveOwnerNoteActorName,
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
    archiveNote: vi.fn(async (_buildingId, _noteId, archive) => archive),
    ...overrides,
  };
}

describe("owner note normalization", () => {
  it("checks stable IDs without coercing unknown runtime values", () => {
    expect(isStableId("note_12345678")).toBe(true);
    expect(isStableId("bad/key")).toBe(false);
    expect(isStableId(12345678)).toBe(false);
    expect(isStableId(null)).toBe(false);
    expect(isStableId(undefined)).toBe(false);
  });

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

  it.each([
    "2026-02-30T02:00:00.000Z",
    "2026/08/09 02:00:00",
    "2026-08-09",
    "2026-08-09T02:00:00.000",
    0,
  ])("rejects non-canonical recordedAt value %s", (recordedAt) => {
    expect(() => normalizeOwnerNoteDrafts([
      { localId: "note_12345678", body: "메모", recordedAt },
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
  it("accepts an actor name at the exact 256-byte boundary", async () => {
    const exactBoundaryName = "a".repeat(256);

    await expect(
      resolveOwnerNoteActorName(
        actor,
        vi.fn(async () => `  ${exactBoundaryName}  `),
      ),
    ).resolves.toBe(exactBoundaryName);
  });

  it("falls back to the verified token name when a multibyte profile name exceeds 256 bytes", async () => {
    const oversizedKoreanName = "가".repeat(86);

    await expect(
      resolveOwnerNoteActorName(
        { ...actor, tokenDisplayName: "  Verified token name  " },
        vi.fn(async () => oversizedKoreanName),
      ),
    ).resolves.toBe("Verified token name");
  });

  it("falls back when a candidate contains a C0 or DEL control character", async () => {
    await expect(
      resolveOwnerNoteActorName(
        { ...actor, tokenDisplayName: "Verified token name" },
        vi.fn(async () => "Bad\u0000profile"),
      ),
    ).resolves.toBe("Verified token name");

    await expect(
      resolveOwnerNoteActorName(
        { ...actor, tokenDisplayName: "Bad\u007ftoken" },
        vi.fn(async () => null),
      ),
    ).resolves.toBe("브링 담당자");
  });

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

  it("validates the complete runtime payload before any dependency call", async () => {
    const malformed: Array<[unknown, string]> = [
      [undefined, "owner_note_building_id_invalid"],
      [null, "owner_note_building_id_invalid"],
      [{}, "owner_note_building_id_invalid"],
      [{ ...input, buildingId: 12345678 }, "owner_note_building_id_invalid"],
      [{ ...input, localId: 12345678 }, "owner_note_id_invalid"],
      [{ ...input, body: 42 }, "owner_note_body_required"],
      [{ ...input, recordedAt: "2026-08-09" }, "owner_note_recorded_at_invalid"],
    ];

    for (const [payload, code] of malformed) {
      const deps = dependencies();
      await expect(appendOwnerNoteCore(payload as never, actor, deps))
        .rejects.toThrow(code);
      expect(deps.isEnabled).not.toHaveBeenCalled();
      expect(deps.consumeRateLimit).not.toHaveBeenCalled();
      expect(deps.isAssigned).not.toHaveBeenCalled();
      expect(deps.buildingExists).not.toHaveBeenCalled();
    }
  });

  it("orders enabled, rate, assignment, and building checks before data access", async () => {
    const calls: string[] = [];
    const deps = dependencies({
      isEnabled: vi.fn(async () => { calls.push("enabled"); return true; }),
      consumeRateLimit: vi.fn(async () => { calls.push("rate"); return true; }),
      isAssigned: vi.fn(async () => { calls.push("assignment"); return true; }),
      buildingExists: vi.fn(async () => { calls.push("building"); return true; }),
      getUserDisplayName: vi.fn(async () => { calls.push("profile"); return "서버 프로필 이름"; }),
      readNote: vi.fn(async () => { calls.push("read"); return null; }),
      createNoteIfAbsent: vi.fn(async (_buildingId, _noteId, candidate) => {
        calls.push("create");
        return candidate;
      }),
    });

    await appendOwnerNoteCore(input, actor, deps);

    expect(calls).toEqual([
      "enabled",
      "rate",
      "assignment",
      "building",
      "profile",
      "read",
      "create",
    ]);
  });

  it("rate-limits before assignment and building fanout", async () => {
    const deps = dependencies({ consumeRateLimit: vi.fn(async () => false) });

    await expect(appendOwnerNoteCore(input, actor, deps))
      .rejects.toThrow("owner_note_rate_limited");
    expect(deps.isEnabled).toHaveBeenCalledOnce();
    expect(deps.consumeRateLimit).toHaveBeenCalledOnce();
    expect(deps.isAssigned).not.toHaveBeenCalled();
    expect(deps.buildingExists).not.toHaveBeenCalled();
    expect(deps.getUserDisplayName).not.toHaveBeenCalled();
    expect(deps.readNote).not.toHaveBeenCalled();
  });

  it("bounds reviewer and unassigned denials without building fanout", async () => {
    const reviewerDeps = dependencies();
    await expect(appendOwnerNoteCore(
      input,
      { ...actor, role: "reviewer" },
      reviewerDeps,
    )).rejects.toThrow("owner_note_forbidden");
    expect(reviewerDeps.consumeRateLimit).toHaveBeenCalledOnce();
    expect(reviewerDeps.isAssigned).not.toHaveBeenCalled();
    expect(reviewerDeps.buildingExists).not.toHaveBeenCalled();

    const staffDeps = dependencies({ isAssigned: vi.fn(async () => false) });
    await expect(appendOwnerNoteCore(input, actor, staffDeps))
      .rejects.toThrow("owner_note_forbidden");
    expect(staffDeps.consumeRateLimit).toHaveBeenCalledOnce();
    expect(staffDeps.isAssigned).toHaveBeenCalledOnce();
    expect(staffDeps.buildingExists).not.toHaveBeenCalled();
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

  it.each([
    ["disabled actor", { isEnabled: vi.fn(async () => false) }, actor],
    ["unassigned staff", { isAssigned: vi.fn(async () => false) }, actor],
    ["reviewer", {}, { ...actor, role: "reviewer" as const }],
    ["rate limit", { consumeRateLimit: vi.fn(async () => false) }, actor],
    ["missing building", { buildingExists: vi.fn(async () => false) }, actor],
  ])("never mutates a note for %s", async (_label, overrides, rejectedActor) => {
    const deps = dependencies(overrides);

    await expect(appendOwnerNoteCore(input, rejectedActor, deps)).rejects.toThrow();

    expect(deps.createNoteIfAbsent).not.toHaveBeenCalled();
    expect(deps.archiveNote).not.toHaveBeenCalled();
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

  it("validates the complete runtime payload before dependencies", async () => {
    const malformed: Array<[unknown, string]> = [
      [undefined, "owner_note_building_id_invalid"],
      [null, "owner_note_building_id_invalid"],
      [{}, "owner_note_building_id_invalid"],
      [{ ...input, buildingId: 12345678 }, "owner_note_building_id_invalid"],
      [{ ...input, noteId: 12345678 }, "owner_note_id_invalid"],
    ];

    for (const [payload, code] of malformed) {
      const deps = dependencies();
      await expect(archiveOwnerNoteCore(payload as never, admin, deps))
        .rejects.toThrow(code);
      expect(deps.isEnabled).not.toHaveBeenCalled();
      expect(deps.consumeRateLimit).not.toHaveBeenCalled();
      expect(deps.readNote).not.toHaveBeenCalled();
      expect(deps.archiveNote).not.toHaveBeenCalled();
    }
  });

  it("rate-limits before role denial and note reads", async () => {
    const staffDeps = dependencies();
    await expect(archiveOwnerNoteCore(input, actor, staffDeps))
      .rejects.toThrow("owner_note_archive_forbidden");
    expect(staffDeps.consumeRateLimit).toHaveBeenCalledOnce();
    expect(staffDeps.readNote).not.toHaveBeenCalled();

    const limitedDeps = dependencies({ consumeRateLimit: vi.fn(async () => false) });
    await expect(archiveOwnerNoteCore(input, admin, limitedDeps))
      .rejects.toThrow("owner_note_rate_limited");
    expect(limitedDeps.readNote).not.toHaveBeenCalled();
    expect(limitedDeps.archiveNote).not.toHaveBeenCalled();
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

  it("returns the atomic archive winner when another administrator wins the race", async () => {
    const winningArchive = {
      archivedAt: "2026-08-09T01:59:59.000Z",
      archivedBy: "admin-winner",
    };
    const deps = dependencies({
      readNote: vi.fn(async () => note()),
      archiveNote: vi.fn(async () => winningArchive),
    });

    await expect(archiveOwnerNoteCore(input, admin, deps)).resolves.toEqual(winningArchive);
  });

  it.each([
    [{ archivedAt: "not-a-date", archivedBy: "admin-1" }],
    [{ archivedAt: NOW, archivedBy: "" }],
    [{ archivedAt: NOW, archivedBy: 123 }],
  ])("rejects invalid atomic archive metadata %#", async (archiveResult) => {
    const deps = dependencies({
      readNote: vi.fn(async () => note()),
      archiveNote: vi.fn(async () => archiveResult as never),
    });

    await expect(archiveOwnerNoteCore(input, admin, deps))
      .rejects.toThrow("owner_note_archive_result_invalid");
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
