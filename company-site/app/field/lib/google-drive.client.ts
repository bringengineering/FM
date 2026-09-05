"use client";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  trashed?: boolean;
  capabilities?: { canAddChildren?: boolean };
  appProperties?: Record<string, string>;
}

export interface GoogleDriveClientOptions {
  getAccessToken: () => string | null;
  fetch?: DriveFetch;
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function safeError(response: Response, context: "root" | "general"): Promise<never> {
  if (response.status === 401) throw new Error("drive_authorization_required");
  if (response.status === 403 || (context === "root" && response.status === 404)) {
    throw new Error("drive_root_access_denied");
  }
  if (response.status === 404) throw new Error("drive_item_not_found");
  if (response.status === 429 || response.status >= 500) {
    throw new Error("drive_temporarily_unavailable");
  }
  throw new Error("drive_request_failed");
}

function normalizeDriveFile(value: unknown): DriveFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("drive_response_invalid");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.mimeType !== "string") {
    throw new Error("drive_response_invalid");
  }
  return record as unknown as DriveFile;
}

export class GoogleDriveClient {
  private readonly getAccessToken: () => string | null;
  private readonly fetch: DriveFetch;

  constructor(options: GoogleDriveClientOptions) {
    this.getAccessToken = options.getAccessToken;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const token = this.getAccessToken();
    if (!token) throw new Error("drive_connection_required");
    return { Authorization: `Bearer ${token}`, ...extra };
  }

  private async json(response: Response, context: "root" | "general" = "general"): Promise<unknown> {
    if (!response.ok) return safeError(response, context);
    try {
      return await response.json();
    } catch {
      throw new Error("drive_response_invalid");
    }
  }

  async getFile(fileId: string, context: "root" | "general" = "general"): Promise<DriveFile> {
    const params = new URLSearchParams({
      fields: "id,name,mimeType,size,trashed,capabilities(canAddChildren),appProperties",
      supportsAllDrives: "true",
    });
    const response = await this.fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${params}`, {
      headers: this.headers(),
    });
    return normalizeDriveFile(await this.json(response, context));
  }

  async validateWritableRoot(folderId: string): Promise<DriveFile> {
    const folder = await this.getFile(folderId, "root");
    if (folder.mimeType !== FOLDER_MIME || folder.trashed || folder.capabilities?.canAddChildren === false) {
      throw new Error("drive_root_access_denied");
    }
    return folder;
  }

  async findExactChild(
    parentId: string,
    name: string,
    kind: "folder" | "file" = "folder",
    appProperties?: Record<string, string>,
  ): Promise<DriveFile | null> {
    const clauses = [
      `'${escapeQuery(parentId)}' in parents`,
      `name = '${escapeQuery(name)}'`,
      "trashed = false",
      kind === "folder" ? `mimeType = '${FOLDER_MIME}'` : `mimeType != '${FOLDER_MIME}'`,
    ];
    for (const [key, value] of Object.entries(appProperties ?? {})) {
      clauses.push(`appProperties has { key='${escapeQuery(key)}' and value='${escapeQuery(value)}' }`);
    }
    const params = new URLSearchParams({
      q: clauses.join(" and "),
      fields: "files(id,name,mimeType,size,appProperties)",
      pageSize: "2",
      spaces: "drive",
    });
    const response = await this.fetch(`${DRIVE_FILES_URL}?${params}`, {
      headers: this.headers(),
    });
    const value = await this.json(response);
    const files = (value as { files?: unknown[] }).files;
    if (!Array.isArray(files) || files.length === 0) return null;
    return normalizeDriveFile(files[0]);
  }

  async findByAppProperty(key: string, value: string): Promise<DriveFile | null> {
    const params = new URLSearchParams({
      q: `appProperties has { key='${escapeQuery(key)}' and value='${escapeQuery(value)}' } and trashed = false`,
      fields: "files(id,name,mimeType,size,appProperties)",
      pageSize: "2",
      spaces: "drive",
    });
    const response = await this.fetch(`${DRIVE_FILES_URL}?${params}`, {
      headers: this.headers(),
    });
    const result = await this.json(response);
    const files = (result as { files?: unknown[] }).files;
    if (!Array.isArray(files) || files.length === 0) return null;
    return normalizeDriveFile(files[0]);
  }

  async createFolder(parentId: string, name: string): Promise<DriveFile> {
    const response = await this.fetch(`${DRIVE_FILES_URL}?fields=id,name,mimeType`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    return normalizeDriveFile(await this.json(response));
  }

  async copyFile(input: {
    fileId: string;
    parentId: string;
    name: string;
    appProperties?: Record<string, string>;
  }): Promise<DriveFile> {
    const response = await this.fetch(
      `${DRIVE_FILES_URL}/${encodeURIComponent(input.fileId)}/copy?fields=id,name,mimeType,size,appProperties`,
      {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: input.name,
          parents: [input.parentId],
          appProperties: input.appProperties,
        }),
      },
    );
    return normalizeDriveFile(await this.json(response));
  }

  async ensureFolderPath(rootId: string, segments: string[]): Promise<string> {
    let parentId = rootId;
    for (const segment of segments) {
      const existing = await this.findExactChild(parentId, segment, "folder");
      const folder = existing ?? await this.createFolder(parentId, segment);
      parentId = folder.id;
    }
    return parentId;
  }

  async uploadSmallFile(input: {
    parentId: string;
    name: string;
    mimeType: string;
    blob: Blob;
    appProperties?: Record<string, string>;
  }): Promise<DriveFile> {
    const body = new FormData();
    body.append("metadata", new Blob([JSON.stringify({
      name: input.name,
      parents: [input.parentId],
      appProperties: input.appProperties,
    })], { type: "application/json" }));
    body.append("file", input.blob, input.name);
    const response = await this.fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,mimeType,size,appProperties`, {
      method: "POST",
      headers: this.headers(),
      body,
    });
    return normalizeDriveFile(await this.json(response));
  }

  async startResumableUpload(input: {
    parentId: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    appProperties?: Record<string, string>;
  }): Promise<string> {
    const response = await this.fetch(`${DRIVE_UPLOAD_URL}?uploadType=resumable&fields=id,name,mimeType,size,appProperties`, {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": input.mimeType,
        "X-Upload-Content-Length": String(input.sizeBytes),
      }),
      body: JSON.stringify({
        name: input.name,
        parents: [input.parentId],
        appProperties: input.appProperties,
      }),
    });
    if (!response.ok) await safeError(response, "general");
    const location = response.headers.get("location");
    if (!location) throw new Error("drive_resumable_session_missing");
    return location;
  }

  async uploadResumable(input: {
    sessionUrl: string;
    blob: Blob;
    mimeType: string;
    chunkSize?: number;
    startOffset?: number;
    onProgress?: (uploadedBytes: number) => void | Promise<void>;
  }): Promise<DriveFile> {
    const chunkSize = Math.max(1, input.chunkSize ?? 8 * 1_024 * 1_024);
    let offset = Math.max(0, input.startOffset ?? 0);
    while (offset < input.blob.size) {
      const endExclusive = Math.min(input.blob.size, offset + chunkSize);
      const response = await this.fetch(input.sessionUrl, {
        method: "PUT",
        headers: this.headers({
          "Content-Type": input.mimeType,
          "Content-Length": String(endExclusive - offset),
          "Content-Range": `bytes ${offset}-${endExclusive - 1}/${input.blob.size}`,
        }),
        body: input.blob.slice(offset, endExclusive),
      });
      if (response.status === 308) {
        const acknowledged = /bytes=\d+-(\d+)/.exec(response.headers.get("range") ?? "");
        offset = acknowledged ? Number(acknowledged[1]) + 1 : endExclusive;
        await input.onProgress?.(offset);
        continue;
      }
      const file = normalizeDriveFile(await this.json(response));
      await input.onProgress?.(input.blob.size);
      return file;
    }
    throw new Error("drive_resumable_state_invalid");
  }

  async downloadFile(fileId: string): Promise<Blob> {
    const response = await this.fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`, {
      headers: this.headers(),
    });
    if (!response.ok) await safeError(response, "general");
    return response.blob();
  }
}
