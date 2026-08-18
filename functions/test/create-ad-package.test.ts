import { describe, expect, it, vi } from "vitest";

import {
  createAdPackageCore,
  type CreateAdPackageDependencies,
} from "../src/packages/create-ad-package.js";

const REQUEST = "11111111-1111-4111-8111-111111111111";
const MEDIA = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-10T05:00:00.000Z";

function input() {
  return {
    requestId: REQUEST,
    listingId: "listing-1",
    approvedMediaIds: [MEDIA],
    representativeMediaIds: [MEDIA],
  };
}

function dependencies(
  overrides: Partial<CreateAdPackageDependencies> = {},
): CreateAdPackageDependencies {
  return {
    isEnabled: vi.fn(async () => true),
    commit: vi.fn(async (commitInput) => ({
      status: "committed" as const,
      write: true as const,
      state: {},
      result: {
        packageId: `ad-package-${commitInput.requestId}`,
        listingId: commitInput.listingId,
        version: 3,
        status: "reviewed" as const,
      },
    })),
    now: vi.fn(() => NOW),
    ...overrides,
  };
}

describe("createAdPackageCore", () => {
  it.each(["reviewer", "admin"] as const)(
    "delegates one atomic commit for an enabled %s",
    async (role) => {
      const deps = dependencies();
      await expect(createAdPackageCore(
        input(),
        { uid: `${role}-1`, role },
        deps,
      )).resolves.toEqual({
        packageId: `ad-package-${REQUEST}`,
        listingId: "listing-1",
        version: 3,
        status: "reviewed",
      });
      expect(deps.commit).toHaveBeenCalledTimes(1);
      expect(deps.commit).toHaveBeenCalledWith({
        ...input(),
        actorId: `${role}-1`,
        occurredAt: NOW,
      });
    },
  );

  it("blocks staff and disabled reviewers before commit", async () => {
    const staff = dependencies();
    await expect(createAdPackageCore(
      input(),
      { uid: "staff-1", role: "staff" },
      staff,
    )).rejects.toThrow("ad_package_forbidden");
    expect(staff.commit).not.toHaveBeenCalled();

    const disabled = dependencies({ isEnabled: vi.fn(async () => false) });
    await expect(createAdPackageCore(
      input(),
      { uid: "reviewer-1", role: "reviewer" },
      disabled,
    )).rejects.toThrow("ad_package_forbidden");
    expect(disabled.commit).not.toHaveBeenCalled();
  });

  it("maps a conflicting receipt to the stable request conflict", async () => {
    const deps = dependencies({
      commit: vi.fn(async () => ({
        status: "requestConflict" as const,
        write: false as const,
        state: {},
      })),
    });
    await expect(createAdPackageCore(
      input(),
      { uid: "reviewer-1", role: "reviewer" },
      deps,
    )).rejects.toThrow("ad_package_request_conflict");
  });

  it("rejects malformed ids, duplicates, and noncanonical server time", async () => {
    const malformed = dependencies();
    await expect(createAdPackageCore(
      { ...input(), approvedMediaIds: ["media-1"] },
      { uid: "reviewer-1", role: "reviewer" },
      malformed,
    )).rejects.toThrow("ad_package_invalid");
    expect(malformed.commit).not.toHaveBeenCalled();

    const duplicate = dependencies();
    await expect(createAdPackageCore(
      { ...input(), representativeMediaIds: [MEDIA, MEDIA] },
      { uid: "reviewer-1", role: "reviewer" },
      duplicate,
    )).rejects.toThrow("ad_package_invalid");
    expect(duplicate.commit).not.toHaveBeenCalled();

    const badTime = dependencies({ now: vi.fn(() => "2026-08-10 05:00:00") });
    await expect(createAdPackageCore(
      input(),
      { uid: "reviewer-1", role: "reviewer" },
      badTime,
    )).rejects.toThrow("ad_package_state_invalid");
    expect(badTime.commit).not.toHaveBeenCalled();
  });
});
