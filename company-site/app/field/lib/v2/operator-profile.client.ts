import { get, ref } from "firebase/database";

import { database } from "../firebase.client";
import { isPlainFieldRecord, isSafeFieldId } from "./contracts";

export interface FieldOperatorProfile {
  readonly operatorId: string;
  readonly displayName: string;
  readonly active: true;
  readonly sortOrder: number;
}

export interface FieldOperatorPreference {
  readonly operatorId: string;
  readonly selectedAt: string;
}

export type ReadTeamProfiles = (path: "crmCompany/teamProfiles") => Promise<unknown>;

const PROFILE_KEYS = Object.freeze(["active", "displayName", "sortOrder"]);
const PREFERENCE_KEYS = Object.freeze(["operatorId", "selectedAt"]);

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function validProfile(operatorId: string, value: unknown): FieldOperatorProfile | null {
  if (!isSafeFieldId(operatorId) || !isPlainFieldRecord(value) || !exactKeys(value, PROFILE_KEYS)) {
    return null;
  }
  const displayName = typeof value.displayName === "string" ? value.displayName.trim() : "";
  if (
    value.active !== true
    || displayName !== value.displayName
    || displayName.length === 0
    || new TextEncoder().encode(displayName).byteLength > 120
    || /[\u0000-\u001f\u007f]/u.test(displayName)
    || !Number.isSafeInteger(value.sortOrder)
    || (value.sortOrder as number) < 0
    || (value.sortOrder as number) > 100_000
  ) return null;
  return Object.freeze({
    operatorId,
    displayName,
    active: true,
    sortOrder: value.sortOrder as number,
  });
}

async function readFirebaseTeamProfiles(path: "crmCompany/teamProfiles"): Promise<unknown> {
  return (await get(ref(database, path))).val() as unknown;
}

export async function loadActiveOperatorProfiles(
  read: ReadTeamProfiles = readFirebaseTeamProfiles,
): Promise<readonly FieldOperatorProfile[]> {
  let value: unknown;
  try {
    value = await read("crmCompany/teamProfiles");
  } catch {
    throw new Error("field_operator_profiles_unavailable");
  }
  if (!isPlainFieldRecord(value)) throw new Error("field_operator_profiles_invalid");
  return Object.freeze(
    Object.entries(value)
      .map(([operatorId, profile]) => validProfile(operatorId, profile))
      .filter((profile): profile is FieldOperatorProfile => profile !== null)
      .sort((left, right) => left.sortOrder - right.sortOrder
        || left.displayName.localeCompare(right.displayName, "ko")
        || left.operatorId.localeCompare(right.operatorId)),
  );
}

export function operatorPreferenceKey(uid: string): string {
  if (!isSafeFieldId(uid)) throw new Error("field_auth_uid_invalid");
  return `bring.field.v2.operator.${uid}`;
}

function removeQuietly(storage: Pick<Storage, "removeItem">, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // A disabled storage backend is treated like no saved preference.
  }
}

export function readOperatorPreference(
  storage: Pick<Storage, "getItem" | "removeItem">,
  uid: string,
  activeProfiles: readonly FieldOperatorProfile[],
): string | null {
  const key = operatorPreferenceKey(uid);
  let value: unknown;
  try {
    const serialized = storage.getItem(key);
    if (!serialized) return null;
    value = JSON.parse(serialized) as unknown;
  } catch {
    removeQuietly(storage, key);
    return null;
  }
  if (
    !isPlainFieldRecord(value)
    || !exactKeys(value, PREFERENCE_KEYS)
    || !isSafeFieldId(value.operatorId)
    || !canonicalTimestamp(value.selectedAt)
    || !activeProfiles.some((profile) => profile.operatorId === value.operatorId)
  ) {
    removeQuietly(storage, key);
    return null;
  }
  return value.operatorId;
}

export function writeOperatorPreference(
  storage: Pick<Storage, "setItem">,
  uid: string,
  operatorId: string,
  now: () => Date = () => new Date(),
): FieldOperatorPreference {
  if (!isSafeFieldId(operatorId)) throw new Error("field_operator_invalid");
  const selectedAt = now().toISOString();
  const preference = Object.freeze({ operatorId, selectedAt });
  storage.setItem(operatorPreferenceKey(uid), JSON.stringify(preference));
  return preference;
}

export function clearOperatorPreference(
  storage: Pick<Storage, "removeItem">,
  uid: string,
): void {
  removeQuietly(storage, operatorPreferenceKey(uid));
}
