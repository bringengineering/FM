"use client";

import {
  equalTo,
  onValue,
  orderByChild,
  query,
  ref,
} from "firebase/database";
import { httpsCallable } from "firebase/functions";

import type {
  SaveFieldRegistrationInput,
  SaveFieldRegistrationResult,
} from "./registration-draft";
import { auth, database, functions } from "./firebase.client";
import type { Building, UserRole } from "./types";

export interface SetManagementContractStatusInput {
  requestId: string;
  buildingId: string;
  status: "active" | "paused" | "ended";
  startedOn?: string;
  endedOn?: string;
}

export interface SetManagementContractStatusResult {
  buildingId: string;
  status: "active" | "paused" | "ended";
}

export type SaveRegistrationInvoker = (
  input: SaveFieldRegistrationInput,
) => Promise<{ data: SaveFieldRegistrationResult }>;

export type SetContractInvoker = (
  input: SetManagementContractStatusInput,
) => Promise<{ data: SetManagementContractStatusResult }>;

export type PendingManagementContractSubscriber = (
  listener: (buildings: Building[]) => void,
  onError?: (error: Error) => void,
) => () => void;

const roles = new Set<UserRole>(["admin", "staff", "reviewer"]);
const PATH_ID_MAX_BYTES = 128;
const RENDERED_STRING_MAX_LENGTH = 4_096;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && roles.has(value as UserRole);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) || 0;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}

function isPathSafeId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    utf8ByteLength(value) <= PATH_ID_MAX_BYTES &&
    !/[.#$\[\]\/]/u.test(value) &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= RENDERED_STRING_MAX_LENGTH;
}

function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1_000 || month < 1 || month > 12 || day < 1) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function isOptionalDateOnly(value: unknown): value is string | undefined {
  return value === undefined || isValidDateOnly(value);
}

function isFiniteCoordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= minimum && value <= maximum;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isPathSafeId);
}

function isPendingBuilding(value: unknown): value is Building {
  if (!isRecord(value) || !isPathSafeId(value.id) ||
    !isNonEmptyString(value.managementNumber) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.roadAddress) ||
    !isFiniteCoordinate(value.latitude, -90, 90) ||
    !isFiniteCoordinate(value.longitude, -180, 180) ||
    !isStringArray(value.assignedStaffIds) ||
    !isNonEmptyString(value.createdAt) ||
    !isPathSafeId(value.createdBy) ||
    !isNonEmptyString(value.updatedAt) ||
    !isPathSafeId(value.updatedBy) ||
    !isRecord(value.parking) ||
    typeof value.parking.available !== "boolean" ||
    !isRecord(value.managementContract)) {
    return false;
  }

  if (value.parking.totalSpaces !== undefined &&
    (typeof value.parking.totalSpaces !== "number" ||
      !Number.isFinite(value.parking.totalSpaces) ||
      value.parking.totalSpaces < 0)) {
    return false;
  }

  const contract = value.managementContract;
  return contract.status === "pending" &&
    isOptionalDateOnly(contract.startedOn) &&
    isOptionalDateOnly(contract.endedOn) &&
    isNonEmptyString(contract.updatedAt) &&
    isPathSafeId(contract.updatedBy);
}

async function defaultSaveInvoker(input: SaveFieldRegistrationInput) {
  const callable = httpsCallable<SaveFieldRegistrationInput, SaveFieldRegistrationResult>(
    functions,
    "saveFieldRegistration",
  );
  return callable(input);
}

async function defaultSetContractInvoker(input: SetManagementContractStatusInput) {
  const callable = httpsCallable<
    SetManagementContractStatusInput,
    SetManagementContractStatusResult
  >(functions, "setManagementContractStatus");
  return callable(input);
}

export async function saveFieldRegistration(
  input: SaveFieldRegistrationInput,
  invoke: SaveRegistrationInvoker = defaultSaveInvoker,
): Promise<SaveFieldRegistrationResult> {
  const result = await invoke(input);
  return result.data;
}

export async function setManagementContractStatus(
  input: SetManagementContractStatusInput,
  invoke: SetContractInvoker = defaultSetContractInvoker,
): Promise<SetManagementContractStatusResult> {
  const result = await invoke(input);
  return result.data;
}

export async function getCurrentFieldRole(): Promise<UserRole | null> {
  const user = auth.currentUser;
  if (!user) return null;

  const tokenResult = await user.getIdTokenResult();
  if (
    tokenResult.claims.fieldPlatform !== true ||
    !isUserRole(tokenResult.claims.fieldRole)
  ) {
    return null;
  }

  return tokenResult.claims.fieldRole;
}

function normalizePendingBuildings(value: unknown): Building[] {
  if (!isRecord(value)) return [];

  return Object.entries(value).flatMap(([id, item]) => {
    if (!isRecord(item) || !isPathSafeId(id)) return [];
    const candidate = { ...item, id };
    return isPendingBuilding(candidate) ? [candidate] : [];
  });
}

export function subscribePendingManagementContracts(
  listener: (buildings: Building[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const pendingContracts = query(
    ref(database, "fieldPlatform/buildings"),
    orderByChild("managementContract/status"),
    equalTo("pending"),
  );

  return onValue(
    pendingContracts,
    (snapshot) => listener(normalizePendingBuildings(snapshot.val())),
    (error) => onError?.(error instanceof Error ? error : new Error("field_pending_load_failed")),
  );
}
