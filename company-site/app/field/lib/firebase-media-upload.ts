"use client";

import {
  getMetadata as getFirebaseMetadata,
  ref as createFirebaseStorageReference,
  uploadBytesResumable as startFirebaseResumableUpload,
  type FirebaseStorage,
  type FullMetadata,
  type StorageReference,
  type UploadMetadata,
} from "firebase/storage";

import {
  excludeFieldMedia as callExcludeFieldMedia,
  finalizeFieldMedia as callFinalizeFieldMedia,
} from "./field-api.client";
import { storage as firebaseStorage } from "./firebase.client";
import type {
  FinalizeFieldMediaInput,
  FinalizeFieldMediaResult,
  MediaUploadPort,
  StoredMediaObject,
} from "./media-upload";

export interface FirebaseStorageMetadata {
  fullPath: string;
  generation: string;
  size: number;
  contentType?: string;
  timeCreated: string;
  md5Hash?: string;
  crc32c?: string;
  customMetadata?: Record<string, string>;
}

export interface FirebaseUploadSnapshot {
  bytesTransferred: number;
  totalBytes: number;
}

export interface FirebaseUploadTask {
  readonly snapshot: { metadata: FirebaseStorageMetadata };
  on(
    event: "state_changed",
    next: (snapshot: FirebaseUploadSnapshot) => void,
    error: (error: unknown) => void,
    complete: () => void,
  ): () => void;
}

export interface FirebaseMediaUploadDependencies {
  storage: unknown;
  ref(storage: unknown, path: string): unknown;
  getMetadata(reference: unknown): Promise<FirebaseStorageMetadata>;
  uploadBytesResumable(
    reference: unknown,
    data: Blob | Uint8Array | ArrayBuffer,
    metadata: {
      contentType: string;
      customMetadata: Record<string, string>;
    },
  ): FirebaseUploadTask;
  finalizeFieldMedia(
    input: FinalizeFieldMediaInput,
  ): Promise<FinalizeFieldMediaResult>;
  excludeFieldMedia(input: {
    mediaId: string;
    requestId: string;
  }): Promise<unknown>;
}

function firebaseMetadata(metadata: FullMetadata): FirebaseStorageMetadata {
  const extended = metadata as FullMetadata & { crc32c?: string };
  return {
    fullPath: metadata.fullPath,
    generation: metadata.generation,
    size: metadata.size,
    contentType: metadata.contentType,
    timeCreated: metadata.timeCreated,
    md5Hash: metadata.md5Hash,
    crc32c: extended.crc32c,
    customMetadata: metadata.customMetadata,
  };
}

const defaultDependencies: FirebaseMediaUploadDependencies = {
  storage: firebaseStorage,
  ref(storage, path) {
    return createFirebaseStorageReference(storage as FirebaseStorage, path);
  },
  async getMetadata(reference) {
    return firebaseMetadata(await getFirebaseMetadata(reference as StorageReference));
  },
  uploadBytesResumable(reference, data, metadata) {
    const task = startFirebaseResumableUpload(
      reference as StorageReference,
      data,
      metadata satisfies UploadMetadata,
    );
    return {
      get snapshot() {
        return { metadata: firebaseMetadata(task.snapshot.metadata) };
      },
      on(_event, next, error, complete) {
        return task.on(
          "state_changed",
          (snapshot) => next({
            bytesTransferred: snapshot.bytesTransferred,
            totalBytes: snapshot.totalBytes,
          }),
          error,
          complete,
        );
      },
    };
  },
  finalizeFieldMedia: callFinalizeFieldMedia,
  excludeFieldMedia: callExcludeFieldMedia,
};

function toStoredMediaObject(
  metadata: FirebaseStorageMetadata,
): StoredMediaObject {
  return {
    path: metadata.fullPath,
    generation: metadata.generation,
    sizeBytes: metadata.size,
    contentType: metadata.contentType ?? "",
    timeCreated: metadata.timeCreated,
    md5Hash: metadata.md5Hash,
    crc32c: metadata.crc32c,
    customMetadata: { ...(metadata.customMetadata ?? {}) },
  };
}

function isObjectNotFound(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "storage/object-not-found",
  );
}

function uploadProgress(snapshot: FirebaseUploadSnapshot): number {
  if (
    !Number.isFinite(snapshot.bytesTransferred)
    || !Number.isFinite(snapshot.totalBytes)
    || snapshot.totalBytes <= 0
  ) {
    return 0;
  }
  return (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
}

export function createFirebaseMediaUploadPort(
  dependencies: Partial<FirebaseMediaUploadDependencies> = {},
): MediaUploadPort {
  const resolved: FirebaseMediaUploadDependencies = {
    ...defaultDependencies,
    ...dependencies,
  };

  return {
    async inspect(path) {
      const reference = resolved.ref(resolved.storage, path);
      try {
        return toStoredMediaObject(await resolved.getMetadata(reference));
      } catch (error) {
        if (isObjectNotFound(error)) return null;
        throw error;
      }
    },

    async upload(item, onProgress) {
      if (!item.stagingPath) {
        throw new Error("capture_staging_path_missing");
      }
      if (!item.blob) {
        throw new Error("capture_blob_missing");
      }

      const reference = resolved.ref(resolved.storage, item.stagingPath);
      const task = resolved.uploadBytesResumable(reference, item.blob, {
        contentType: item.descriptor.mimeType,
        customMetadata: {
          captureSessionId: item.captureSessionId,
          capturedBy: item.uid,
          mediaId: item.mediaId,
        },
      });

      return new Promise<StoredMediaObject>((resolve, reject) => {
        task.on(
          "state_changed",
          (snapshot) => onProgress(uploadProgress(snapshot)),
          reject,
          () => resolve(toStoredMediaObject(task.snapshot.metadata)),
        );
      });
    },

    finalize(input) {
      return resolved.finalizeFieldMedia(input);
    },

    async exclude(input) {
      await resolved.excludeFieldMedia(input);
    },
  };
}
