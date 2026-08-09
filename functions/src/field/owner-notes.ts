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

export interface OwnerNoteArchiveMetadata {
  archivedAt: string;
  archivedBy: string;
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
  /**
   * Atomically archives an existing note and returns the metadata that won.
   * The adapter must preserve an existing archive, fail if the note was deleted,
   * and never recreate a missing note.
   */
  archiveNote(
    buildingId: string,
    noteId: string,
    archive: OwnerNoteArchiveMetadata,
  ): Promise<OwnerNoteArchiveMetadata>;
}

const STABLE_ID = /^[A-Za-z0-9_-]{8,128}$/;

export function isStableId(value: unknown): value is string {
  return typeof value === "string" && STABLE_ID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalUtcIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function normalizeOwnerNoteDrafts(value: unknown): OwnerNoteDraftInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("owner_note_drafts_invalid");
  }

  const seen = new Set<string>();
  return value.map((candidate) => {
    if (!isRecord(candidate)) {
      throw new Error("owner_note_draft_invalid");
    }

    const localId = typeof candidate.localId === "string" ? candidate.localId : "";
    const body = typeof candidate.body === "string" ? candidate.body.trim() : "";
    const recordedAt = candidate.recordedAt;

    if (!isStableId(localId)) throw new Error("owner_note_id_invalid");
    if (seen.has(localId)) throw new Error("owner_note_id_duplicate");
    if (!body) throw new Error("owner_note_body_required");
    if (body.length > 2000) throw new Error("owner_note_body_too_long");
    if (!isCanonicalUtcIso(recordedAt)) {
      throw new Error("owner_note_recorded_at_invalid");
    }

    seen.add(localId);
    return { localId, body, recordedAt };
  });
}

function normalizeAppendInput(value: unknown): {
  buildingId: string;
  localId: string;
  body: string;
  recordedAt: string;
} {
  if (!isRecord(value)) {
    throw new Error("owner_note_building_id_invalid");
  }
  const source = value;
  const buildingId = source.buildingId;
  if (!isStableId(buildingId)) {
    throw new Error("owner_note_building_id_invalid");
  }

  const [draft] = normalizeOwnerNoteDrafts([{
    localId: source.localId,
    body: source.body,
    recordedAt: source.recordedAt,
  }]);
  return { buildingId, ...draft };
}

function normalizeArchiveInput(value: unknown): { buildingId: string; noteId: string } {
  if (!isRecord(value)) {
    throw new Error("owner_note_building_id_invalid");
  }
  const source = value;
  const buildingId = source.buildingId;
  if (!isStableId(buildingId)) {
    throw new Error("owner_note_building_id_invalid");
  }
  const noteId = source.noteId;
  if (!isStableId(noteId)) throw new Error("owner_note_id_invalid");
  return { buildingId, noteId };
}

function normalizeArchiveMetadata(value: unknown): OwnerNoteArchiveMetadata {
  const source = isRecord(value) ? value : null;
  const archivedAt = source?.archivedAt;
  const archivedBy = source?.archivedBy;
  if (
    !isCanonicalUtcIso(archivedAt)
    || typeof archivedBy !== "string"
    || archivedBy.length === 0
    || archivedBy.length > 128
    || archivedBy.trim() !== archivedBy
  ) {
    throw new Error("owner_note_archive_result_invalid");
  }
  return { archivedAt, archivedBy };
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
  const normalized = normalizeAppendInput(input);
  if (!(await dependencies.isEnabled(actor.uid))) {
    throw new Error("owner_note_forbidden");
  }
  if (!(await dependencies.consumeRateLimit(
    actor.uid,
    actor.sessionId ?? "current",
    "append",
    30,
  ))) {
    throw new Error("owner_note_rate_limited");
  }
  if (!(await canAppend(normalized.buildingId, actor, dependencies))) {
    throw new Error("owner_note_forbidden");
  }
  if (!(await dependencies.buildingExists(normalized.buildingId))) {
    throw new Error("owner_note_building_not_found");
  }

  const profileName = (await dependencies.getUserDisplayName(actor.uid))?.trim();
  const actorName = profileName || actor.tokenDisplayName?.trim() || "브링 담당자";
  const candidate = buildOwnerNoteRecord({
    buildingId: normalized.buildingId,
    draft: normalized,
    actorUid: actor.uid,
    actorName,
    createdAt: dependencies.nowIso(),
  });
  const existing = await dependencies.readNote(normalized.buildingId, normalized.localId);
  if (existing) {
    if (!sameImmutableNote(existing, candidate)) {
      throw new Error("owner_note_id_conflict");
    }
    return existing;
  }

  const stored = await dependencies.createNoteIfAbsent(
    normalized.buildingId,
    normalized.localId,
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
  const normalized = normalizeArchiveInput(input);
  if (!(await dependencies.isEnabled(actor.uid))) {
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
  if (actor.role !== "admin") {
    throw new Error("owner_note_archive_forbidden");
  }

  const existing = await dependencies.readNote(normalized.buildingId, normalized.noteId);
  if (!existing) throw new Error("owner_note_not_found");
  if (existing.archivedAt && existing.archivedBy) {
    return normalizeArchiveMetadata({
      archivedAt: existing.archivedAt,
      archivedBy: existing.archivedBy,
    });
  }

  const archive = normalizeArchiveMetadata({
    archivedAt: dependencies.nowIso(),
    archivedBy: actor.uid,
  });
  const stored = await dependencies.archiveNote(
    normalized.buildingId,
    normalized.noteId,
    archive,
  );
  return normalizeArchiveMetadata(stored);
}
