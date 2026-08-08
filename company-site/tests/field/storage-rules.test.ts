// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-bring-field-platform";
let environment: RulesTestEnvironment;
const storageEmulatorAvailable = Boolean(
  process.env.FIREBASE_STORAGE_EMULATOR_HOST,
);

function claims(role: "staff" | "reviewer" | "admin" = "staff") {
  return { fieldPlatform: true, fieldRole: role, email_verified: true };
}

beforeAll(async () => {
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
  await environment.cleanup();
});

describe.runIf(storageEmulatorAvailable)("field media storage rules", () => {
  it("accepts claimed users only in their own photo and video paths", async () => {
    const storage = environment.authenticatedContext("staff-1", claims()).storage();
    const otherStorage = environment.authenticatedContext("staff-2", claims()).storage();
    const anonymousStorage = environment.unauthenticatedContext().storage();

    await assertSucceeds(uploadBytes(
      ref(storage, "field-media/staff-1/session-1/photos/photo.jpg"),
      new Uint8Array(1024),
      { contentType: "image/jpeg" },
    ));
    await assertSucceeds(uploadBytes(
      ref(storage, "field-media/staff-1/session-1/videos/video.mp4"),
      new Uint8Array(1024),
      { contentType: "video/mp4" },
    ));
    await assertFails(uploadBytes(
      ref(otherStorage, "field-media/staff-1/session-1/photos/photo.jpg"),
      new Uint8Array(1024),
      { contentType: "image/jpeg" },
    ));
    await assertFails(uploadBytes(
      ref(anonymousStorage, "field-media/staff-1/session-1/photos/photo.jpg"),
      new Uint8Array(1024),
      { contentType: "image/jpeg" },
    ));
  });

  it("rejects wrong MIME types and oversized photos", async () => {
    const storage = environment.authenticatedContext("staff-1", claims()).storage();
    await assertFails(uploadBytes(
      ref(storage, "field-media/staff-1/session-1/photos/not-photo.txt"),
      new Uint8Array(1024),
      { contentType: "text/plain" },
    ));
    await assertFails(uploadBytes(
      ref(storage, "field-media/staff-1/session-1/photos/too-large.jpg"),
      new Uint8Array(25 * 1024 * 1024 + 1),
      { contentType: "image/jpeg" },
    ));
  });

  it("requires the fieldPlatform claim even for the matching uid", async () => {
    const storage = environment.authenticatedContext("staff-1", {}).storage();
    await assertFails(uploadBytes(
      ref(storage, "field-media/staff-1/session-1/photos/photo.jpg"),
      new Uint8Array(1024),
      { contentType: "image/jpeg" },
    ));
  });

  it("declares the approved photo and video byte limits", async () => {
    const rules = await readFile(resolve("../storage.rules"), "utf8");
    expect(rules).toContain("25 * 1024 * 1024");
    expect(rules).toContain("500 * 1024 * 1024");
  });
});
