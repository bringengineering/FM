"use client";

import {
  equalTo,
  limitToLast,
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
import type {
  FinalizeFieldMediaInput,
  FinalizeFieldMediaResult,
} from "./media-upload";
import { auth, database, functions } from "./firebase.client";
import type {
  Building,
  CaptureSessionRecord,
  OwnerNote,
  UserRole,
} from "./types";

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

export interface StartFieldCaptureSessionInput {
  requestId: string;
  captureSessionId: string;
  visitId: string;
  buildingId: string;
  unitId?: string;
  listingId?: string;
  visitType: "initial" | "vacancyRefresh";
}

export interface StartFieldCaptureSessionResult {
  captureSessionId: string;
  visitId: string;
}

export interface CaptureTarget {
  id: string;
  buildingId: string;
  buildingName: string;
  unitId?: string;
  unitLabel?: string;
  listingId?: string;
  source: "management" | "advertising";
}

export interface FieldCaptureWorkspaceResult {
  targets: CaptureTarget[];
  openSessions: CaptureSessionRecord[];
}

export interface FieldMediaAccessResult {
  url: string;
  expiresAt: string;
}

export interface ExcludeFieldMediaInput {
  mediaId: string;
  requestId: string;
}

export interface ExcludeFieldMediaResult {
  mediaId: string;
  excludedAt: string;
  excludedBy: string;
}

export interface AppendOwnerNoteInput {
  buildingId: string;
  localId: string;
  body: string;
  recordedAt: string;
}

export interface ArchiveOwnerNoteInput {
  buildingId: string;
  noteId: string;
}

export interface ArchiveOwnerNoteResult {
  archivedAt: string;
  archivedBy: string;
}

export type SaveRegistrationInvoker = (
  input: SaveFieldRegistrationInput,
) => Promise<{ data: SaveFieldRegistrationResult }>;

export type SetContractInvoker = (
  input: SetManagementContractStatusInput,
) => Promise<{ data: SetManagementContractStatusResult }>;

export type StartCaptureSessionInvoker = (
  input: StartFieldCaptureSessionInput,
) => Promise<{ data: StartFieldCaptureSessionResult }>;

export type LoadFieldCaptureWorkspaceInvoker = () => Promise<{
  data: FieldCaptureWorkspaceResult;
}>;

export type FinalizeFieldMediaInvoker = (
  input: FinalizeFieldMediaInput,
) => Promise<{ data: FinalizeFieldMediaResult }>;

export type GetFieldMediaAccessInvoker = (
  input: { mediaId: string },
) => Promise<{ data: FieldMediaAccessResult }>;

export type ExcludeFieldMediaInvoker = (
  input: ExcludeFieldMediaInput,
) => Promise<{ data: ExcludeFieldMediaResult }>;

export type AppendOwnerNoteInvoker = (
  input: AppendOwnerNoteInput,
) => Promise<{ data: { note: OwnerNote } }>;

export type ArchiveOwnerNoteInvoker = (
  input: ArchiveOwnerNoteInput,
) => Promise<{ data: ArchiveOwnerNoteResult }>;

export type PendingManagementContractSubscriber = (
  listener: (buildings: Building[]) => void,
  onError?: (error: Error) => void,
) => () => void;

const roles = new Set<UserRole>(["admin", "staff", "reviewer"]);
const PATH_ID_MAX_BYTES = 128;
const RENDERED_STRING_MAX_LENGTH = 4_096;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const REPLAY_PROTECTED_CALLABLE_OPTIONS = {
  limitedUseAppCheckTokens: true,
} as const;

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

function isCanonicalUtcIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function normalizeOwnerNote(
  key: string,
  value: unknown,
  expectedBuildingId?: string,
): OwnerNote | null {
  if (
    !isPathSafeId(key)
    || !isRecord(value)
    || value.id !== key
    || !isPathSafeId(value.id)
    || !isPathSafeId(value.buildingId)
    || (expectedBuildingId !== undefined && value.buildingId !== expectedBuildingId)
    || typeof value.body !== "string"
    || value.body.length === 0
    || value.body.length > 2_000
    || value.body !== value.body.trim()
    || !isCanonicalUtcIso(value.recordedAt)
    || !isCanonicalUtcIso(value.createdAt)
    || !isPathSafeId(value.createdBy)
    || typeof value.createdByName !== "string"
    || value.createdByName.trim().length === 0
    || value.createdByName !== value.createdByName.trim()
    || utf8ByteLength(value.createdByName.trim()) > 256
    || /[\u0000-\u001f\u007f]/u.test(value.createdByName)
  ) {
    return null;
  }

  const hasArchivedAt = Object.prototype.hasOwnProperty.call(value, "archivedAt");
  const hasArchivedBy = Object.prototype.hasOwnProperty.call(value, "archivedBy");
  if (hasArchivedAt !== hasArchivedBy) return null;
  if (
    hasArchivedAt
    && (!isCanonicalUtcIso(value.archivedAt) || !isPathSafeId(value.archivedBy))
  ) {
    return null;
  }

  return {
    id: value.id,
    buildingId: value.buildingId,
    body: value.body,
    recordedAt: value.recordedAt,
    createdAt: value.createdAt,
    createdBy: value.createdBy,
    createdByName: value.createdByName,
    ...(hasArchivedAt
      ? {
          archivedAt: value.archivedAt as string,
          archivedBy: value.archivedBy as string,
        }
      : {}),
  };
}

function normalizeArchiveOwnerNoteResult(value: unknown): ArchiveOwnerNoteResult | null {
  if (
    !isRecord(value)
    || !isCanonicalUtcIso(value.archivedAt)
    || !isPathSafeId(value.archivedBy)
  ) {
    return null;
  }
  return {
    archivedAt: value.archivedAt,
    archivedBy: value.archivedBy,
  };
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

async function defaultStartCaptureSessionInvoker(
  input: StartFieldCaptureSessionInput,
) {
  const callable = httpsCallable<
    StartFieldCaptureSessionInput,
    StartFieldCaptureSessionResult
  >(
    functions,
    "startFieldCaptureSession",
    REPLAY_PROTECTED_CALLABLE_OPTIONS,
  );
  return callable(input);
}

async function defaultLoadFieldCaptureWorkspaceInvoker() {
  const callable = httpsCallable<undefined, FieldCaptureWorkspaceResult>(
    functions,
    "listFieldCaptureWorkspace",
    REPLAY_PROTECTED_CALLABLE_OPTIONS,
  );
  return callable(undefined);
}

async function defaultFinalizeFieldMediaInvoker(
  input: FinalizeFieldMediaInput,
) {
  const callable = httpsCallable<
    FinalizeFieldMediaInput,
    FinalizeFieldMediaResult
  >(functions, "finalizeFieldMedia", REPLAY_PROTECTED_CALLABLE_OPTIONS);
  return callable(input);
}

async function defaultGetFieldMediaAccessInvoker(input: { mediaId: string }) {
  const callable = httpsCallable<
    { mediaId: string },
    FieldMediaAccessResult
  >(functions, "getFieldMediaAccess", REPLAY_PROTECTED_CALLABLE_OPTIONS);
  return callable(input);
}

async function defaultExcludeFieldMediaInvoker(input: ExcludeFieldMediaInput) {
  const callable = httpsCallable<
    ExcludeFieldMediaInput,
    ExcludeFieldMediaResult
  >(functions, "excludeFieldMedia", REPLAY_PROTECTED_CALLABLE_OPTIONS);
  return callable(input);
}

async function defaultAppendOwnerNoteInvoker(input: AppendOwnerNoteInput) {
  const callable = httpsCallable<
    AppendOwnerNoteInput,
    { note: OwnerNote }
  >(functions, "appendOwnerNote");
  return callable(input);
}

async function defaultArchiveOwnerNoteInvoker(input: ArchiveOwnerNoteInput) {
  const callable = httpsCallable<
    ArchiveOwnerNoteInput,
    ArchiveOwnerNoteResult
  >(functions, "archiveOwnerNote");
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

export async function startFieldCaptureSession(
  input: StartFieldCaptureSessionInput,
  invoke: StartCaptureSessionInvoker = defaultStartCaptureSessionInvoker,
): Promise<StartFieldCaptureSessionResult> {
  const payload: StartFieldCaptureSessionInput = {
    requestId: input.requestId,
    captureSessionId: input.captureSessionId,
    visitId: input.visitId,
    buildingId: input.buildingId,
    ...(input.unitId === undefined ? {} : { unitId: input.unitId }),
    ...(input.listingId === undefined ? {} : { listingId: input.listingId }),
    visitType: input.visitType,
  };
  const result = await invoke(payload);
  if (
    !isRecord(result.data)
    || result.data.captureSessionId !== input.captureSessionId
    || result.data.visitId !== input.visitId
  ) {
    throw new Error("field_capture_session_response_invalid");
  }
  return {
    captureSessionId: result.data.captureSessionId,
    visitId: result.data.visitId,
  };
}

function normalizeCaptureTarget(value: unknown): CaptureTarget | null {
  if (
    !isRecord(value)
    || !isPathSafeId(value.id)
    || !isPathSafeId(value.buildingId)
    || !isNonEmptyString(value.buildingName)
    || (value.source !== "management" && value.source !== "advertising")
  ) {
    return null;
  }
  const hasUnitId = value.unitId !== undefined;
  const hasUnitLabel = value.unitLabel !== undefined;
  if (
    hasUnitId !== hasUnitLabel
    || (hasUnitId && !isPathSafeId(value.unitId))
    || (hasUnitLabel && !isNonEmptyString(value.unitLabel))
    || (value.source === "management" && value.listingId !== undefined)
    || (value.source === "advertising" && !isPathSafeId(value.listingId))
  ) {
    return null;
  }
  return {
    id: value.id,
    buildingId: value.buildingId,
    buildingName: value.buildingName,
    ...(hasUnitId ? { unitId: value.unitId as string } : {}),
    ...(hasUnitLabel ? { unitLabel: value.unitLabel as string } : {}),
    ...(value.source === "advertising"
      ? { listingId: value.listingId as string }
      : {}),
    source: value.source,
  };
}

function normalizeOpenCaptureSession(value: unknown): CaptureSessionRecord | null {
  if (
    !isRecord(value)
    || !isPathSafeId(value.id)
    || !isPathSafeId(value.requestId)
    || !isPathSafeId(value.buildingId)
    || !isPathSafeId(value.visitId)
    || !isPathSafeId(value.createdBy)
    || value.status !== "open"
    || !isCanonicalUtcIso(value.createdAt)
    || !isCanonicalUtcIso(value.updatedAt)
    || (value.unitId !== undefined && !isPathSafeId(value.unitId))
    || (value.listingId !== undefined && !isPathSafeId(value.listingId))
  ) {
    return null;
  }
  return {
    id: value.id,
    requestId: value.requestId,
    buildingId: value.buildingId,
    ...(value.unitId === undefined ? {} : { unitId: value.unitId }),
    ...(value.listingId === undefined ? {} : { listingId: value.listingId }),
    visitId: value.visitId,
    createdBy: value.createdBy,
    status: "open",
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export async function loadFieldCaptureWorkspace(
  invoke: LoadFieldCaptureWorkspaceInvoker = defaultLoadFieldCaptureWorkspaceInvoker,
): Promise<FieldCaptureWorkspaceResult> {
  const result = await invoke();
  if (
    !isRecord(result.data)
    || !Array.isArray(result.data.targets)
    || !Array.isArray(result.data.openSessions)
  ) {
    throw new Error("field_capture_workspace_response_invalid");
  }
  const targets = result.data.targets.map(normalizeCaptureTarget);
  const openSessions = result.data.openSessions.map(normalizeOpenCaptureSession);
  if (
    targets.some((value) => value === null)
    || openSessions.some((value) => value === null)
    || new Set(targets.map((value) => value!.id)).size !== targets.length
    || new Set(openSessions.map((value) => value!.id)).size !== openSessions.length
  ) {
    throw new Error("field_capture_workspace_response_invalid");
  }
  return {
    targets: targets as CaptureTarget[],
    openSessions: (openSessions as CaptureSessionRecord[]).sort((left, right) => (
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      || right.id.localeCompare(left.id)
    )),
  };
}

export async function finalizeFieldMedia(
  input: FinalizeFieldMediaInput,
  invoke: FinalizeFieldMediaInvoker = defaultFinalizeFieldMediaInvoker,
): Promise<FinalizeFieldMediaResult> {
  const result = await invoke({ ...input });
  if (
    !isRecord(result.data)
    || result.data.mediaId !== input.mediaId
    || result.data.uploadState !== "finalized"
    || result.data.driveSyncState !== "queued"
    || typeof result.data.storagePath !== "string"
    || !result.data.storagePath.startsWith("field-media-finalized/")
    || !isCanonicalUtcIso(result.data.finalizedAt)
  ) {
    throw new Error("field_media_finalize_response_invalid");
  }
  return result.data as unknown as FinalizeFieldMediaResult;
}

export async function getFieldMediaAccess(
  mediaId: string,
  invoke: GetFieldMediaAccessInvoker = defaultGetFieldMediaAccessInvoker,
): Promise<FieldMediaAccessResult> {
  const result = await invoke({ mediaId });
  if (
    !isRecord(result.data)
    || typeof result.data.url !== "string"
    || !result.data.url.startsWith("https://")
    || !isCanonicalUtcIso(result.data.expiresAt)
  ) {
    throw new Error("field_media_access_response_invalid");
  }
  return {
    url: result.data.url,
    expiresAt: result.data.expiresAt,
  };
}

export async function excludeFieldMedia(
  input: ExcludeFieldMediaInput,
  invoke: ExcludeFieldMediaInvoker = defaultExcludeFieldMediaInvoker,
): Promise<ExcludeFieldMediaResult> {
  const result = await invoke({ mediaId: input.mediaId, requestId: input.requestId });
  if (
    !isRecord(result.data)
    || result.data.mediaId !== input.mediaId
    || !isCanonicalUtcIso(result.data.excludedAt)
    || !isPathSafeId(result.data.excludedBy)
  ) {
    throw new Error("field_media_exclusion_response_invalid");
  }
  return {
    mediaId: result.data.mediaId,
    excludedAt: result.data.excludedAt,
    excludedBy: result.data.excludedBy,
  };
}

export async function appendOwnerNote(
  input: AppendOwnerNoteInput,
  invoke: AppendOwnerNoteInvoker = defaultAppendOwnerNoteInvoker,
): Promise<OwnerNote> {
  const payload: AppendOwnerNoteInput = {
    buildingId: input.buildingId,
    localId: input.localId,
    body: input.body,
    recordedAt: input.recordedAt,
  };
  const result = await invoke(payload);
  const note = isRecord(result.data)
    ? normalizeOwnerNote(input.localId, result.data.note, input.buildingId)
    : null;
  if (!note) throw new Error("field_owner_note_response_invalid");
  return note;
}

export async function archiveOwnerNote(
  input: ArchiveOwnerNoteInput,
  invoke: ArchiveOwnerNoteInvoker = defaultArchiveOwnerNoteInvoker,
): Promise<ArchiveOwnerNoteResult> {
  const payload: ArchiveOwnerNoteInput = {
    buildingId: input.buildingId,
    noteId: input.noteId,
  };
  const result = await invoke(payload);
  const archive = normalizeArchiveOwnerNoteResult(result.data);
  if (!archive) throw new Error("field_owner_note_archive_response_invalid");
  return archive;
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

export function sortOwnerNotes(
  value: unknown,
  expectedBuildingId?: string,
): OwnerNote[] {
  if (!isRecord(value)) return [];

  return Object.entries(value)
    .flatMap(([key, candidate]) => {
      const note = normalizeOwnerNote(key, candidate, expectedBuildingId);
      return note && !note.archivedAt ? [note] : [];
    })
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function subscribeOwnerNotes(
  buildingId: string,
  listener: (notes: OwnerNote[]) => void,
  onError: (error: Error) => void,
  options: { limit?: number } = { limit: 50 },
): () => void {
  if (!isPathSafeId(buildingId)) {
    throw new Error("field_owner_note_building_id_invalid");
  }
  if (!isRecord(options)) {
    throw new Error("field_owner_note_options_invalid");
  }
  const limit = options.limit;
  if (
    limit !== undefined
    && (
      typeof limit !== "number"
      || !Number.isSafeInteger(limit)
      || limit <= 0
    )
  ) {
    throw new Error("field_owner_note_limit_invalid");
  }

  const ordered = query(
    ref(database, `fieldPlatform/ownerNotes/${buildingId}`),
    orderByChild("createdAt"),
  );
  const notesQuery = limit === undefined
    ? ordered
    : query(ordered, limitToLast(limit));

  return onValue(
    notesQuery,
    (snapshot) => listener(sortOwnerNotes(snapshot.val(), buildingId)),
    (error) => onError(
      error instanceof Error ? error : new Error("field_owner_note_load_failed"),
    ),
  );
}
