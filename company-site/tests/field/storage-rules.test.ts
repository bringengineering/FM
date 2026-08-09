// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteObject,
  getMetadata,
  ref,
  uploadBytes,
} from "firebase/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-bring-field-platform";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const PHOTO_ID = "22222222-2222-4222-8222-222222222222";
const VIDEO_ID = "33333333-3333-4333-8333-333333333333";
let environment: RulesTestEnvironment;
const storageEmulatorAvailable = Boolean(
  process.env.FIREBASE_STORAGE_EMULATOR_HOST,
);

function claims(role: "staff" | "reviewer" | "admin" = "staff") {
  return { fieldPlatform: true, fieldRole: role, email_verified: true };
}

function metadata(
  mediaId: string,
  contentType: string,
  capturedBy = "staff-1",
) {
  return {
    contentType,
    customMetadata: {
      capturedBy,
      captureSessionId: SESSION_ID,
      mediaId,
    },
  };
}

beforeAll(async () => {
  if (!storageEmulatorAvailable) return;
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      host: "127.0.0.1",
      port: 9199,
      rules: await readFile(resolve("../storage.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await environment?.cleanup();
});

describe.runIf(storageEmulatorAvailable)("field media storage rules", () => {
  it("allows only the uploader to create and read an exact immutable staging object", async () => {
    const storage = environment.authenticatedContext("staff-1", claims()).storage();
    const otherStorage = environment.authenticatedContext("staff-2", claims()).storage();
    const reviewerStorage = environment
      .authenticatedContext("reviewer-1", claims("reviewer"))
      .storage();
    const anonymousStorage = environment.unauthenticatedContext().storage();
    const photoPath = `field-media/staff-1/${SESSION_ID}/photos/${PHOTO_ID}.jpg`;
    const photoRef = ref(storage, photoPath);
    const photoMetadata = metadata(PHOTO_ID, "image/jpeg");

    await assertSucceeds(uploadBytes(
      photoRef,
      new Uint8Array(1024),
      photoMetadata,
    ));
    await assertFails(uploadBytes(photoRef, new Uint8Array(1024), photoMetadata));
    await assertFails(deleteObject(photoRef));
    await assertSucceeds(getMetadata(photoRef));
    await assertFails(getMetadata(ref(reviewerStorage, photoPath)));
    await assertFails(uploadBytes(
      ref(otherStorage, photoPath),
      new Uint8Array(1024),
      photoMetadata,
    ));
    await assertFails(uploadBytes(
      ref(anonymousStorage, photoPath),
      new Uint8Array(1024),
      photoMetadata,
    ));
  });

  it("accepts an exact video tuple and rejects malformed paths, metadata, MIME, and size", async () => {
    const storage = environment.authenticatedContext("staff-1", claims()).storage();
    const videoPath = `field-media/staff-1/${SESSION_ID}/videos/${VIDEO_ID}.mp4`;

    await assertSucceeds(uploadBytes(
      ref(storage, videoPath),
      new Uint8Array(1024),
      metadata(VIDEO_ID, "video/mp4"),
    ));
    await assertFails(uploadBytes(
      ref(storage, `field-media/staff-1/${SESSION_ID}/photos/not-a-uuid.jpg`),
      new Uint8Array(1024),
      metadata(PHOTO_ID, "image/jpeg"),
    ));
    await assertFails(uploadBytes(
      ref(storage, `field-media/staff-1/not-a-uuid/photos/${PHOTO_ID}.jpg`),
      new Uint8Array(1024),
      metadata(PHOTO_ID, "image/jpeg"),
    ));
    await assertFails(uploadBytes(
      ref(storage, `field-media/staff-1/${SESSION_ID}/photos/${PHOTO_ID}.svg`),
      new Uint8Array(1024),
      metadata(PHOTO_ID, "image/svg+xml"),
    ));
    await assertFails(uploadBytes(
      ref(storage, `field-media/staff-1/${SESSION_ID}/photos/${PHOTO_ID}.png`),
      new Uint8Array(1024),
      metadata(PHOTO_ID, "image/jpeg"),
    ));
    await assertFails(uploadBytes(
      ref(storage, `field-media/staff-1/${SESSION_ID}/photos/${PHOTO_ID}.jpg`),
      new Uint8Array(1024),
      metadata(PHOTO_ID, "image/jpeg", "staff-2"),
    ));
    await assertFails(uploadBytes(
      ref(storage, `field-media/staff-1/${SESSION_ID}/photos/${PHOTO_ID}.jpg`),
      new Uint8Array(25 * 1024 * 1024 + 1),
      metadata(PHOTO_ID, "image/jpeg"),
    ));
  });

  it("requires the fieldPlatform claim even for the matching uid", async () => {
    const storage = environment.authenticatedContext("staff-1", {}).storage();
    await assertFails(uploadBytes(
      ref(storage, `field-media/staff-1/${SESSION_ID}/photos/${PHOTO_ID}.jpg`),
      new Uint8Array(1024),
      metadata(PHOTO_ID, "image/jpeg"),
    ));
  });

  it("denies every client role direct access to finalized objects", async () => {
    const finalizedPath = `field-media-finalized/building-1/${PHOTO_ID}.jpg`;
    await environment.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(
        ref(context.storage(), finalizedPath),
        new Uint8Array(1024),
        { contentType: "image/jpeg" },
      );
    });

    for (const [uid, role] of [
      ["staff-1", "staff"],
      ["reviewer-1", "reviewer"],
      ["admin-1", "admin"],
    ] as const) {
      const storage = environment.authenticatedContext(uid, claims(role)).storage();
      await assertFails(getMetadata(ref(storage, finalizedPath)));
    }
  });

});

describe("field media storage rule source", () => {
  it("declares exact approved media types, limits, and finalized-object denial", async () => {
    const rules = await readFile(resolve("../storage.rules"), "utf8");
    expect(rules).toContain("25 * 1024 * 1024");
    expect(rules).toContain("500 * 1024 * 1024");
    for (const mime of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "video/mp4",
      "video/quicktime",
      "video/webm",
    ]) {
      expect(rules).toContain(mime);
    }
    expect(rules).toContain("match /field-media-finalized/{allPaths=**}");
    expect(rules).toMatch(/match \/field-media-finalized\/\{allPaths=\*\*\}\s*\{\s*allow read, write: if false;/u);
    expect(rules).not.toContain("allow create, update");
  });
});
