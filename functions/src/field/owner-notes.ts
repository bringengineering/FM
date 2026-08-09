export type FieldRole = "admin" | "staff" | "reviewer";

export interface OwnerNoteDraftInput {
  localId: string;
  body: string;
  recordedAt: string;
}

export interface OwnerNoteRecord {
  id: string;
  buildingId: string;
  body: string;
  recordedAt: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  archivedAt?: string;
  archivedBy?: string;
}

export interface OwnerNoteActor {
  uid: string;
  role: FieldRole;
  tokenDisplayName?: string;
  sessionId?: string;
}

export interface OwnerNoteDependencies {
  nowIso(): string;
  consumeRateLimit(
    uid: string,
    sessionId: string,
    action: "append" | "archive",
    limit: number,
  ): Promise<boolean>;
  isEnabled(uid: string): Promise<boolean>;
  buildingExists(buildingId: string): Promise<boolean>;
  getUserDisplayName(uid: string): Promise<string | null>;
  isAssigned(buildingId: string, uid: string): Promise<boolean>;
  readNote(buildingId: string, noteId: string): Promise<OwnerNoteRecord | null>;
  createNoteIfAbsent(
    buildingId: string,
    noteId: string,
    note: OwnerNoteRecord,
  ): Promise<OwnerNoteRecord>;
  archiveNote(
    buildingId: string,
    noteId: string,
    archive: { archivedAt: string; archivedBy: string },
  ): Promise<void>;
}

const STABLE_ID = /^[A-Za-z0-9_-]{8,128}$/;

export function normalizeOwnerNoteDrafts(value: unknown): OwnerNoteDraftInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("owner_note_drafts_invalid");
  }

  const seen = new Set<string>();
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("owner_note_draft_invalid");
    }

    const source = candidate as Record<string, unknown>;
    const localId = typeof source.localId === "string" ? source.localId : "";
    const body = typeof source.body === "string" ? source.body.trim() : "";
    const recordedAt = typeof source.recordedAt === "string" ? source.recordedAt : "";

    if (!STABLE_ID.test(localId)) throw new Error("owner_note_id_invalid");
    if (seen.has(localId)) throw new Error("owner_note_id_duplicate");
    if (!body) throw new Error("owner_note_body_required");
    if (body.length > 2000) throw new Error("owner_note_body_too_long");
    if (!Number.isFinite(Date.parse(recordedAt))) {
      throw new Error("owner_note_recorded_at_invalid");
    }

    seen.add(localId);
    return { localId, body, recordedAt };
  });
}

export function buildOwnerNoteRecord(input: {
  buildingId: string;
  draft: OwnerNoteDraftInput;
  actorUid: string;
  actorName: string;
  createdAt: string;
}): OwnerNoteRecord {
  const [draft] = normalizeOwnerNoteDrafts([input.draft]);
  return {
    id: draft.localId,
    buildingId: input.buildingId,
    body: draft.body,
    recordedAt: draft.recordedAt,
    createdAt: input.createdAt,
    createdBy: input.actorUid,
    createdByName: input.actorName,
  };
}

async function canAppend(
  buildingId: string,
  actor: OwnerNoteActor,
  dependencies: OwnerNoteDependencies,
): Promise<boolean> {
  if (actor.role === "admin") return true;
  return actor.role === "staff" && dependencies.isAssigned(buildingId, actor.uid);
}

function sameImmutableNote(left: OwnerNoteRecord, right: OwnerNoteRecord): boolean {
  return left.id === right.id
    && left.buildingId === right.buildingId
    && left.body === right.body
    && left.recordedAt === right.recordedAt
    && left.createdBy === right.createdBy;
}

export async function appendOwnerNoteCore(
  input: {
    buildingId: string;
    localId: string;
    body: string;
    recordedAt: string;
  },
  actor: OwnerNoteActor,
  dependencies: OwnerNoteDependencies,
): Promise<OwnerNoteRecord> {
  if (!STABLE_ID.test(input.buildingId)) {
    throw new Error("owner_note_building_id_invalid");
  }
  if (!(await dependencies.isEnabled(actor.uid))) {
    throw new Error("owner_note_forbidden");
  }
  if (!(await canAppend(input.buildingId, actor, dependencies))) {
    throw new Error("owner_note_forbidden");
  }
  if (!(await dependencies.buildingExists(input.buildingId))) {
    throw new Error("owner_note_building_not_found");
  }
  if (!(await dependencies.consumeRateLimit(
    actor.uid,
    actor.sessionId ?? "current",
    "append",
    30,
  ))) {
    throw new Error("owner_note_rate_limited");
  }

  const [draft] = normalizeOwnerNoteDrafts([input]);
  const profileName = (await dependencies.getUserDisplayName(actor.uid))?.trim();
  const actorName = profileName || actor.tokenDisplayName?.trim() || "브링 담당자";
  const candidate = buildOwnerNoteRecord({
    buildingId: input.buildingId,
    draft,
    actorUid: actor.uid,
    actorName,
    createdAt: dependencies.nowIso(),
  });
  const existing = await dependencies.readNote(input.buildingId, draft.localId);
  if (existing) {
    if (!sameImmutableNote(existing, candidate)) {
      throw new Error("owner_note_id_conflict");
    }
    return existing;
  }

  const stored = await dependencies.createNoteIfAbsent(
    input.buildingId,
    draft.localId,
    candidate,
  );
  if (!sameImmutableNote(stored, candidate)) {
    throw new Error("owner_note_id_conflict");
  }
  return stored;
}

export async function archiveOwnerNoteCore(
  input: { buildingId: string; noteId: string },
  actor: OwnerNoteActor,
  dependencies: OwnerNoteDependencies,
): Promise<{ archivedAt: string; archivedBy: string }> {
  if (!STABLE_ID.test(input.buildingId)) {
    throw new Error("owner_note_building_id_invalid");
  }
  if (!(await dependencies.isEnabled(actor.uid))) {
    throw new Error("owner_note_archive_forbidden");
  }
  if (actor.role !== "admin") {
    throw new Error("owner_note_archive_forbidden");
  }
  if (!(await dependencies.consumeRateLimit(
    actor.uid,
    actor.sessionId ?? "current",
    "archive",
    20,
  ))) {
    throw new Error("owner_note_rate_limited");
  }
  if (!STABLE_ID.test(input.noteId)) throw new Error("owner_note_id_invalid");

  const existing = await dependencies.readNote(input.buildingId, input.noteId);
  if (!existing) throw new Error("owner_note_not_found");
  if (existing.archivedAt && existing.archivedBy) {
    return { archivedAt: existing.archivedAt, archivedBy: existing.archivedBy };
  }

  const archive = { archivedAt: dependencies.nowIso(), archivedBy: actor.uid };
  await dependencies.archiveNote(input.buildingId, input.noteId, archive);
  return archive;
}
