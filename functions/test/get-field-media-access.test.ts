import { describe, expect, it, vi } from "vitest";

import {
  getFieldMediaAccessCore,
  type FieldMediaAccessDependencies,
} from "../src/field/get-field-media-access.js";

function dependencies(
  overrides: Partial<FieldMediaAccessDependencies> = {},
): FieldMediaAccessDependencies {
  return {
    isEnabled: vi.fn(async () => true),
    readMedia: vi.fn(async () => ({
      id: "media-1",
      buildingId: "b1",
      uploadState: "finalized",
      storagePath: "field-media-finalized/b1/media-1.jpg",
    })),
    isAssigned: vi.fn(async () => true),
    signReadUrl: vi.fn(async (_path, expiresAt) =>
      `https://signed.example/${expiresAt}`),
    nowMs: () => 1_000,
    ...overrides,
  };
}

describe("getFieldMediaAccessCore", () => {
  it("issues an exact five-minute URL only for finalized media and current staff authority", async () => {
    const deps = dependencies();
    await expect(getFieldMediaAccessCore(
      { mediaId: "media-1" },
      { uid: "staff-1", role: "staff" },
      deps,
    )).resolves.toEqual({
      url: "https://signed.example/301000",
      expiresAt: "1970-01-01T00:05:01.000Z",
    });
    expect(deps.signReadUrl).toHaveBeenCalledWith(
      "field-media-finalized/b1/media-1.jpg",
      301_000,
    );
    expect(deps.isAssigned).toHaveBeenCalledWith("b1", "staff-1");
  });

  it.each(["admin", "reviewer"] as const)(
    "lets an enabled %s bypass building assignment",
    async (role) => {
      const deps = dependencies({ isAssigned: vi.fn(async () => false) });
      await expect(getFieldMediaAccessCore(
        { mediaId: "media-1" },
        { uid: `${role}-1`, role },
        deps,
      )).resolves.toMatchObject({ url: expect.stringMatching(/^https:/) });
      expect(deps.isAssigned).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["disabled", { isEnabled: vi.fn(async () => false) }, "field_media_access_forbidden"],
    ["unassigned", { isAssigned: vi.fn(async () => false) }, "field_media_access_forbidden"],
    ["missing", { readMedia: vi.fn(async () => null) }, "field_media_not_found"],
    ["not finalized", { readMedia: vi.fn(async () => ({ id: "media-1", buildingId: "b1", uploadState: "objectStored", storagePath: "field-media/u1/s1/photos/media-1.jpg" })) }, "field_media_not_finalized"],
    ["staging path", { readMedia: vi.fn(async () => ({ id: "media-1", buildingId: "b1", uploadState: "finalized", storagePath: "field-media/u1/s1/photos/media-1.jpg" })) }, "field_media_path_invalid"],
    ["foreign finalized path", { readMedia: vi.fn(async () => ({ id: "media-1", buildingId: "b1", uploadState: "finalized", storagePath: "field-media-finalized/b2/media-1.jpg" })) }, "field_media_path_invalid"],
  ])("denies %s without signing", async (_label, override, code) => {
    const deps = dependencies(override);
    await expect(getFieldMediaAccessCore(
      { mediaId: "media-1" },
      { uid: "staff-1", role: "staff" },
      deps,
    )).rejects.toThrow(code);
    expect(deps.signReadUrl).not.toHaveBeenCalled();
  });

  it("rejects unsafe input and non-HTTPS signer output", async () => {
    const unsafe = dependencies();
    await expect(getFieldMediaAccessCore(
      { mediaId: "bad/path" },
      { uid: "staff-1", role: "staff" },
      unsafe,
    )).rejects.toThrow("field_media_access_invalid");
    expect(unsafe.readMedia).not.toHaveBeenCalled();

    const badSigner = dependencies({
      signReadUrl: vi.fn(async () => "javascript:alert(1)"),
    });
    await expect(getFieldMediaAccessCore(
      { mediaId: "media-1" },
      { uid: "staff-1", role: "staff" },
      badSigner,
    )).rejects.toThrow("field_media_access_state_invalid");
  });
});
