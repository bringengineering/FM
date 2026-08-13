import { describe, expect, it, vi } from "vitest";

import {
  createRegistrationDraftServer,
  registrationDraftServerPath,
} from "../../app/field/lib/server-registration-draft.client";
import {
  REGISTRATION_DRAFT_VERSION,
  createRegistrationDraft,
  type StoredRegistrationDraft,
} from "../../app/field/lib/registration-draft";

function envelope(overrides: Partial<StoredRegistrationDraft> = {}): StoredRegistrationDraft {
  let idCall = 0;
  return {
    ownerUid: "staff-1",
    draftId: "draft-1",
    updatedAt: "2026-08-12T12:00:00.000Z",
    value: createRegistrationDraft(undefined, () => (
      ++idCall === 1
        ? "draft-1"
        : "11111111-1111-4111-8111-111111111111"
    )),
    ...overrides,
  };
}

describe("registration draft server", () => {
  it("uses an account-scoped Firebase path and round-trips a valid draft", async () => {
    const read = vi.fn(async () => envelope());
    const write = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const server = createRegistrationDraftServer({ read, write, remove });

    await expect(server.load("staff-1", "draft-1")).resolves.toMatchObject({
      ownerUid: "staff-1",
      draftId: "draft-1",
      value: { draftVersion: REGISTRATION_DRAFT_VERSION },
    });
    await server.save(envelope());
    await server.remove("staff-1", "draft-1");

    const path = "fieldPlatform/registrationDrafts/staff-1/draft-1";
    expect(registrationDraftServerPath("staff-1", "draft-1")).toBe(path);
    expect(read).toHaveBeenCalledWith(path);
    expect(write).toHaveBeenCalledWith(path, envelope());
    expect(remove).toHaveBeenCalledWith(path);
  });

  it("rejects a server draft whose owner or draft id does not match the requested path", async () => {
    const server = createRegistrationDraftServer({
      read: vi.fn(async () => envelope({ ownerUid: "other-user" })),
      write: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    });

    await expect(server.load("staff-1", "draft-1"))
      .rejects.toThrow("registration_draft_server_scope_mismatch");
  });

  it("never writes a draft to a different account path", async () => {
    const write = vi.fn(async () => undefined);
    const server = createRegistrationDraftServer({
      read: vi.fn(async () => null),
      write,
      remove: vi.fn(async () => undefined),
    });

    await expect(server.save(envelope({ ownerUid: "" })))
      .rejects.toThrow("registration_draft_server_invalid_scope");
    expect(write).not.toHaveBeenCalled();
  });
});
