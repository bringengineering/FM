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

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && roles.has(value as UserRole);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    if (!isRecord(item) || !isRecord(item.managementContract) ||
      item.managementContract.status !== "pending") {
      return [];
    }

    return [{ ...item, id } as unknown as Building];
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
