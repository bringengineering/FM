"use client";

import { get, ref, remove, set } from "firebase/database";

import { database } from "./firebase.client";
import {
  migrateRegistrationDraft,
  type StoredRegistrationDraft,
} from "./registration-draft";

export interface RegistrationDraftServer {
  load(uid: string, draftId: string): Promise<StoredRegistrationDraft | null>;
  save(envelope: StoredRegistrationDraft): Promise<void>;
  remove(uid: string, draftId: string): Promise<void>;
}

export interface RegistrationDraftServerDependencies {
  read(path: string): Promise<unknown>;
  write(path: string, value: StoredRegistrationDraft): Promise<void>;
  remove(path: string): Promise<void>;
}

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/u;

function assertScope(uid: string, draftId: string): void {
  if (!SAFE_PATH_SEGMENT.test(uid) || !SAFE_PATH_SEGMENT.test(draftId)) {
    throw new Error("registration_draft_server_invalid_scope");
  }
}

export function registrationDraftServerPath(uid: string, draftId: string): string {
  assertScope(uid, draftId);
  return `fieldPlatform/registrationDrafts/${uid}/${draftId}`;
}

function normalizeEnvelope(
  raw: unknown,
  uid: string,
  draftId: string,
): StoredRegistrationDraft | null {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("registration_draft_server_invalid_payload");
  }
  const value = raw as Partial<StoredRegistrationDraft>;
  if (value.ownerUid !== uid || value.draftId !== draftId) {
    throw new Error("registration_draft_server_scope_mismatch");
  }
  if (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new Error("registration_draft_server_invalid_payload");
  }
  const migrated = migrateRegistrationDraft(value.value, undefined, () => draftId);
  if (migrated.draftId !== draftId) {
    throw new Error("registration_draft_server_scope_mismatch");
  }
  return {
    ownerUid: uid,
    draftId,
    updatedAt: value.updatedAt,
    value: migrated,
  };
}

export function createRegistrationDraftServer(
  dependencies: RegistrationDraftServerDependencies,
): RegistrationDraftServer {
  return {
    async load(uid, draftId) {
      const path = registrationDraftServerPath(uid, draftId);
      return normalizeEnvelope(await dependencies.read(path), uid, draftId);
    },
    async save(envelope) {
      const path = registrationDraftServerPath(envelope.ownerUid, envelope.draftId);
      const normalized = normalizeEnvelope(
        envelope,
        envelope.ownerUid,
        envelope.draftId,
      );
      if (!normalized) throw new Error("registration_draft_server_invalid_payload");
      await dependencies.write(path, normalized);
    },
    async remove(uid, draftId) {
      await dependencies.remove(registrationDraftServerPath(uid, draftId));
    },
  };
}

export const firebaseRegistrationDraftServer = createRegistrationDraftServer({
  read: async (path) => (await get(ref(database, path))).val(),
  write: async (path, value) => set(ref(database, path), value),
  remove: async (path) => remove(ref(database, path)),
});
