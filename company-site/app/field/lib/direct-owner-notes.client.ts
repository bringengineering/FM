"use client";

import { ref, set, update } from "firebase/database";

import { auth, database } from "./firebase.client";
import type {
  AppendOwnerNoteInput,
  ArchiveOwnerNoteInput,
  ArchiveOwnerNoteResult,
} from "./field-api.client";
import type { OwnerNote } from "./types";

const PATH_ID_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/u;
const NOTE_MAX_LENGTH = 2_000;

function assertPathId(value: string, code: string): void {
  if (!PATH_ID_PATTERN.test(value)) throw new Error(code);
}

function canonicalIso(value: string, code: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(code);
  }
  return value;
}

function currentUser(): { uid: string; displayName: string } {
  const user = auth.currentUser;
  if (!user) throw new Error("field_owner_note_auth_required");
  return {
    uid: user.uid,
    displayName: user.displayName?.trim().slice(0, 80) || "브링 담당자",
  };
}

export async function appendOwnerNoteDirect(
  input: AppendOwnerNoteInput,
  now: () => string = () => new Date().toISOString(),
): Promise<OwnerNote> {
  assertPathId(input.buildingId, "field_owner_note_building_id_invalid");
  assertPathId(input.localId, "field_owner_note_id_invalid");
  const body = input.body.trim();
  if (!body || body.length > NOTE_MAX_LENGTH) {
    throw new Error("field_owner_note_body_invalid");
  }
  const recordedAt = canonicalIso(input.recordedAt, "field_owner_note_recorded_at_invalid");
  const createdAt = canonicalIso(now(), "field_owner_note_created_at_invalid");
  const actor = currentUser();
  const note: OwnerNote = {
    id: input.localId,
    buildingId: input.buildingId,
    body,
    recordedAt,
    createdAt,
    createdBy: actor.uid,
    createdByName: actor.displayName,
  };

  await set(
    ref(database, `fieldPlatform/ownerNotes/${input.buildingId}/${input.localId}`),
    note,
  );
  return note;
}

export async function archiveOwnerNoteDirect(
  input: ArchiveOwnerNoteInput,
  now: () => string = () => new Date().toISOString(),
): Promise<ArchiveOwnerNoteResult> {
  assertPathId(input.buildingId, "field_owner_note_building_id_invalid");
  assertPathId(input.noteId, "field_owner_note_id_invalid");
  const actor = currentUser();
  const result = {
    archivedAt: canonicalIso(now(), "field_owner_note_archive_time_invalid"),
    archivedBy: actor.uid,
  };
  await update(
    ref(database, `fieldPlatform/ownerNotes/${input.buildingId}/${input.noteId}`),
    result,
  );
  return result;
}
