import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  provisionFieldUserCore,
  type ProvisionFieldUserDependencies,
} from "../src/auth/provision-field-user.js";

function createDependencies(
  allowedRecord: { active: boolean; role: "admin" | "staff" | "reviewer" } | null,
) {
  const dependencies: ProvisionFieldUserDependencies = {
    getAllowedEmail: vi.fn(async () => allowedRecord),
    setCustomClaims: vi.fn(async () => undefined),
    writeFieldUser: vi.fn(async () => undefined),
  };
  return dependencies;
}

describe("provisionFieldUserCore", () => {
  it("grants the configured role without writing the email to the user record", async () => {
    const dependencies = createDependencies({ active: true, role: "staff" });

    await expect(
      provisionFieldUserCore({ email: " Staff@Example.com ", uid: "u1" }, dependencies),
    ).resolves.toEqual({ fieldPlatform: true, fieldRole: "staff" });

    const expectedHash = createHash("sha256").update("staff@example.com").digest("hex");
    expect(dependencies.getAllowedEmail).toHaveBeenCalledWith(expectedHash);
    expect(dependencies.setCustomClaims).toHaveBeenCalledWith("u1", {
      fieldPlatform: true,
      fieldRole: "staff",
    });
    expect(dependencies.writeFieldUser).toHaveBeenCalledWith(
      "u1",
      expect.not.objectContaining({ email: expect.anything() }),
    );
  });

  it("rejects an email that is not on the active allowlist", async () => {
    const dependencies = createDependencies(null);

    await expect(
      provisionFieldUserCore({ email: "blocked@example.com", uid: "u2" }, dependencies),
    ).rejects.toThrow("field_user_not_allowed");
    expect(dependencies.setCustomClaims).not.toHaveBeenCalled();
  });

  it("rejects an inactive email record", async () => {
    const dependencies = createDependencies({ active: false, role: "reviewer" });

    await expect(
      provisionFieldUserCore({ email: "reviewer@example.com", uid: "u3" }, dependencies),
    ).rejects.toThrow("field_user_not_allowed");
  });
});
