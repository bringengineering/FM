export const DRIVE_FOLDER_MIME_TYPE =
  "application/vnd.google-apps.folder" as const;

const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;
const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u;
const FORBIDDEN_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/gu;
const MAX_DRIVE_NAME_CHARACTERS = 255;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDriveId(value: unknown): value is string {
  return typeof value === "string" && DRIVE_ID_PATTERN.test(value);
}

function invalidNameFallback(value: unknown): string {
  if (typeof value !== "string") return "미지정";
  const normalized = value
    .normalize("NFKC")
    .replace(FORBIDDEN_NAME_CHARACTERS, " ")
    .replace(/\s+/gu, " ")
    .replace(/_+/gu, "_")
    .trim()
    .replace(/[. ]+$/gu, "");
  return normalized.length > 0 ? normalized : "미지정";
}

export function normalizeDriveName(
  value: unknown,
  fallback = "미지정",
  maxCharacters = 120,
): string {
  if (
    !Number.isSafeInteger(maxCharacters)
    || maxCharacters < 1
    || maxCharacters > MAX_DRIVE_NAME_CHARACTERS
  ) {
    throw new Error("drive_folder_name_invalid");
  }
  const candidate = typeof value === "string"
    ? value
      .normalize("NFKC")
      .replace(FORBIDDEN_NAME_CHARACTERS, " ")
      .replace(/\s+/gu, " ")
      .replace(/_+/gu, "_")
      .trim()
      .replace(/[. ]+$/gu, "")
    : "";
  const safeFallback = invalidNameFallback(fallback);
  const selected = candidate.length > 0 ? candidate : safeFallback;
  const bounded = [...selected].slice(0, maxCharacters).join("")
    .trim()
    .replace(/[. ]+$/gu, "");
  if (bounded.length > 0) return bounded;
  return [...safeFallback].slice(0, maxCharacters).join("") || "_";
}

function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'");
}

export function buildExactFolderQuery(
  parentId: string,
  name: string,
): string {
  if (!isDriveId(parentId)) throw new Error("drive_folder_request_invalid");
  if (
    typeof name !== "string"
    || name.length === 0
    || [...name].length > MAX_DRIVE_NAME_CHARACTERS
    || /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    throw new Error("drive_folder_request_invalid");
  }
  return `'${escapeDriveQueryLiteral(parentId)}' in parents and name = '${
    escapeDriveQueryLiteral(name)
  }' and mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and trashed = false`;
}

export interface DriveFolderListRequest {
  parentId: string;
  name: string;
  query: string;
  pageSize: 3;
  fields: "files(id,name,mimeType,parents,trashed)";
}

export interface DriveFolderCreateRequest {
  parentId: string;
  name: string;
  mimeType: typeof DRIVE_FOLDER_MIME_TYPE;
  fields: "id,name,mimeType,parents,trashed";
}

export interface DriveFolderAdapter {
  listExactFolders(input: DriveFolderListRequest): Promise<unknown>;
  createFolder(input: DriveFolderCreateRequest): Promise<unknown>;
}

export interface DriveFolderStructureInput {
  rootFolderId: string;
  managementNumber: unknown;
  neighborhood: unknown;
  buildingName: unknown;
  unitLabel: unknown;
  captureDate: string;
  sessionSequence: number;
}

export interface DriveFolderStructure {
  ids: {
    root: string;
    building: string;
    unit: string;
    session: string;
    representativePhotos: string;
    originalPhotos: string;
    verticalVideos: string;
  };
  names: {
    building: string;
    unit: string;
    session: string;
    representativePhotos: "01_광고용_대표사진";
    originalPhotos: "02_전체원본사진";
    verticalVideos: "03_세로영상";
  };
}

interface SafeDriveFolder {
  id: string;
  name: string;
  mimeType: typeof DRIVE_FOLDER_MIME_TYPE;
  parents: [string];
  trashed: false;
}

function safeFolder(
  value: unknown,
  expectedParentId: string,
  expectedName: string,
): SafeDriveFolder {
  if (
    !isRecord(value)
    || !isDriveId(value.id)
    || value.name !== expectedName
    || value.mimeType !== DRIVE_FOLDER_MIME_TYPE
    || value.trashed !== false
    || !Array.isArray(value.parents)
    || value.parents.length !== 1
    || value.parents[0] !== expectedParentId
  ) {
    throw new Error("drive_folder_response_invalid");
  }
  return {
    id: value.id,
    name: expectedName,
    mimeType: DRIVE_FOLDER_MIME_TYPE,
    parents: [expectedParentId],
    trashed: false,
  };
}

async function listExact(
  parentId: string,
  name: string,
  adapter: DriveFolderAdapter,
): Promise<SafeDriveFolder[]> {
  const response = await adapter.listExactFolders({
    parentId,
    name,
    query: buildExactFolderQuery(parentId, name),
    pageSize: 3,
    fields: "files(id,name,mimeType,parents,trashed)",
  });
  if (!Array.isArray(response) || response.length > 3) {
    throw new Error("drive_folder_response_invalid");
  }
  return response.map((item) => safeFolder(item, parentId, name));
}

export async function ensureExactDriveFolder(
  parentId: string,
  name: string,
  adapter: DriveFolderAdapter,
): Promise<string> {
  const existing = await listExact(parentId, name, adapter);
  if (existing.length > 1) throw new Error("drive_folder_duplicate");
  if (existing.length === 1) return existing[0].id;

  let created: SafeDriveFolder | null = null;
  try {
    created = safeFolder(await adapter.createFolder({
      parentId,
      name,
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      fields: "id,name,mimeType,parents,trashed",
    }), parentId, name);
  } catch (error) {
    if (error instanceof Error && error.message === "drive_folder_response_invalid") {
      throw error;
    }
    // A concurrent worker may have won the same exact-name create. Re-listing
    // turns that race into idempotent reuse without trusting the error text.
  }

  const afterCreate = await listExact(parentId, name, adapter);
  if (afterCreate.length > 1) throw new Error("drive_folder_duplicate");
  if (afterCreate.length === 1) return afterCreate[0].id;
  if (created) return created.id;
  throw new Error("drive_folder_create_failed");
}

function validCaptureDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed)
    && new Date(parsed).toISOString().slice(0, 10) === value;
}

export async function ensureDriveStructure(
  input: DriveFolderStructureInput,
  adapter: DriveFolderAdapter,
): Promise<DriveFolderStructure> {
  if (
    !isRecord(input)
    || !isDriveId(input.rootFolderId)
    || typeof input.captureDate !== "string"
    || !validCaptureDate(input.captureDate)
    || !Number.isSafeInteger(input.sessionSequence)
    || input.sessionSequence < 1
    || input.sessionSequence > 9_999
  ) {
    throw new Error("drive_folder_request_invalid");
  }

  const managementNumber = normalizeDriveName(
    input.managementNumber,
    "관리번호미지정",
    48,
  );
  const neighborhood = normalizeDriveName(input.neighborhood, "동네미지정", 48);
  const buildingName = normalizeDriveName(input.buildingName, "건물명미지정", 96);
  const names: DriveFolderStructure["names"] = {
    building: normalizeDriveName(
      `${managementNumber}_${neighborhood}_${buildingName}`,
      "관리건물",
      180,
    ),
    unit: normalizeDriveName(input.unitLabel, "공용", 100),
    session: normalizeDriveName(
      `${input.captureDate}_${String(input.sessionSequence).padStart(2, "0")}_공실촬영`,
      `${input.captureDate}_01_공실촬영`,
      80,
    ),
    representativePhotos: "01_광고용_대표사진",
    originalPhotos: "02_전체원본사진",
    verticalVideos: "03_세로영상",
  };

  const building = await ensureExactDriveFolder(
    input.rootFolderId,
    names.building,
    adapter,
  );
  const unit = await ensureExactDriveFolder(building, names.unit, adapter);
  const session = await ensureExactDriveFolder(unit, names.session, adapter);
  const representativePhotos = await ensureExactDriveFolder(
    session,
    names.representativePhotos,
    adapter,
  );
  const originalPhotos = await ensureExactDriveFolder(
    session,
    names.originalPhotos,
    adapter,
  );
  const verticalVideos = await ensureExactDriveFolder(
    session,
    names.verticalVideos,
    adapter,
  );

  return {
    ids: {
      root: input.rootFolderId,
      building,
      unit,
      session,
      representativePhotos,
      originalPhotos,
      verticalVideos,
    },
    names,
  };
}
