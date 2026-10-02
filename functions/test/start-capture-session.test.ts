import { describe, expect, it, vi } from "vitest";

import {
  startCaptureSessionCore,
  type StartCaptureSessionDependencies,
  type StartCaptureSessionInput,
} from "../src/field/start-capture-session.js";

const NOW = "2026-08-09T00:00:00.000Z";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const VISIT_ID = "33333333-3333-4333-8333-333333333333";

const input: StartCaptureSessionInput = {
  requestId: REQUEST_ID,
  captureSessionId: SESSION_ID,
  visitId: VISIT_ID,
  buildingId: "building-1",
  unitId: "unit-1",
  listingId: "listing-1",
  visitType: "vacancyRefresh",
};

const staff = { uid: "staff-1", role: "staff" as const };

function storedSession(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SESSION_ID,
    requestId: REQUEST_ID,
    buildingId: "building-1",
    unitId: "unit-1",
    listingId: "listing-1",
    visitId: VISIT_ID,
    visitType: "vacancyRefresh",
    createdBy: "staff-1",
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function storedVisit(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: VISIT_ID,
    buildingId: "building-1",
    unitId: "unit-1",
    listingId: "listing-1",
    type: "vacancyRefresh",
    assignedUserId: "staff-1",
    checklistTemplateId: "vacancyRefresh",
    checklistTemplateVersion: 1,
    createdAt: NOW,
    createdBy: "staff-1",
    updatedAt: NOW,
    updatedBy: "staff-1",
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<StartCaptureSessionDependencies> = {},
): StartCaptureSessionDependencies {
  return {
    isEnabled: vi.fn(async () => true),
    isAssigned: vi.fn(async () => true),
    readSession: vi.fn(async () => null),
    readVisit: vi.fn(async () => null),
    readUnit: vi.fn(async () => ({ id: "unit-1", buildingId: "building-1" })),
    readListing: vi.fn(async () => ({
      id: "listing-1",
      buildingId: "building-1",
      unitId: "unit-1",
    })),
    writePatch: vi.fn(async () => undefined),
    now: vi.fn(() => NOW),
    ...overrides,
  };
}

describe("startCaptureSessionCore", () => {
  it("creates one assigned visit, session, and audit root patch", async () => {
    const deps = dependencies();

    await expect(startCaptureSessionCore(input, staff, deps)).resolves.toEqual({
      captureSessionId: SESSION_ID,
      visitId: VISIT_ID,
    });

    expect(deps.writePatch).toHaveBeenCalledTimes(1);
    const patch = vi.mocked(deps.writePatch).mock.calls[0][0];
    expect(Object.keys(patch)).toEqual([
      `fieldPlatform/visits/${VISIT_ID}`,
      `fieldPlatform/captureSessions/${SESSION_ID}`,
      `fieldPlatform/auditLogs/capture-session-${REQUEST_ID}`,
    ]);
    expect(patch[`fieldPlatform/visits/${VISIT_ID}`]).toEqual(storedVisit());
    expect(patch[`fieldPlatform/captureSessions/${SESSION_ID}`]).toEqual(
      storedSession(),
    );
    expect(
      patch[`fieldPlatform/auditLogs/capture-session-${REQUEST_ID}`],
    ).toEqual({
      id: `capture-session-${REQUEST_ID}`,
      actorId: "staff-1",
      action: "captureSession.started",
      entityType: "visit",
      entityId: VISIT_ID,
      occurredAt: NOW,
      requestId: REQUEST_ID,
      changes: {
        captureSessionId: { after: SESSION_ID },
      },
    });
  });

  it("returns an exact completed replay without writing again", async () => {
    const deps = dependencies({
      readSession: vi.fn(async () => storedSession({ status: "complete" })),
      readVisit: vi.fn(async () => storedVisit()),
    });

    await expect(startCaptureSessionCore(input, staff, deps)).resolves.toEqual({
      captureSessionId: SESSION_ID,
      visitId: VISIT_ID,
    });
    expect(deps.writePatch).not.toHaveBeenCalled();
    expect(deps.now).not.toHaveBeenCalled();
    expect(deps.readUnit).not.toHaveBeenCalled();
    expect(deps.readListing).not.toHaveBeenCalled();
  });

  it.each([
    ["requestId", "request-1"],
    ["captureSessionId", "00000000-0000-0000-0000-000000000000"],
    ["visitId", "33333333-3333-0333-8333-333333333333"],
  ] as const)("rejects an invalid %s UUID before reads", async (field, value) => {
    const deps = dependencies();

    await expect(
      startCaptureSessionCore({ ...input, [field]: value }, staff, deps),
    ).rejects.toThrow("field_capture_session_invalid");
    expect(deps.isEnabled).not.toHaveBeenCalled();
    expect(deps.writePatch).not.toHaveBeenCalled();
  });

  it.each([
    ["buildingId", "bad/building"],
    ["unitId", "bad#unit"],
    ["listingId", " listing-1"],
    ["visitType", "inspection"],
  ])("rejects an unsafe %s before access checks", async (field, value) => {
    const deps = dependencies();

    await expect(
      startCaptureSessionCore(
        { ...input, [field]: value } as StartCaptureSessionInput,
        staff,
        deps,
      ),
    ).rejects.toThrow("field_capture_session_invalid");
    expect(deps.isEnabled).not.toHaveBeenCalled();
    expect(deps.writePatch).not.toHaveBeenCalled();
  });

  it.each([
    ["reviewer", { uid: "reviewer-1", role: "reviewer" as const }, dependencies(), "field_capture_session_forbidden"],
    ["disabled staff", staff, dependencies({ isEnabled: vi.fn(async () => false) }), "field_capture_session_forbidden"],
    ["unassigned staff", staff, dependencies({ isAssigned: vi.fn(async () => false) }), "field_building_assignment_required"],
  ])("rejects a %s before any write", async (_label, actor, deps, code) => {
    await expect(
      startCaptureSessionCore(input, actor, deps),
    ).rejects.toThrow(code);
    expect(deps.writePatch).not.toHaveBeenCalled();
  });

  it("lets an enabled admin bypass the assignment lookup", async () => {
    const deps = dependencies({
      isAssigned: vi.fn(async () => {
        throw new Error("assignment lookup must be bypassed");
      }),
    });

    await expect(
      startCaptureSessionCore(input, { uid: "admin-1", role: "admin" }, deps),
    ).resolves.toEqual({ captureSessionId: SESSION_ID, visitId: VISIT_ID });
    expect(deps.isAssigned).not.toHaveBeenCalled();
  });

  it.each([
    ["missing unit", { readUnit: vi.fn(async () => null) }, "field_capture_unit_mismatch"],
    ["foreign unit", { readUnit: vi.fn(async () => ({ id: "unit-1", buildingId: "building-2" })) }, "field_capture_unit_mismatch"],
    ["missing listing", { readListing: vi.fn(async () => null) }, "field_capture_listing_mismatch"],
    ["foreign listing", { readListing: vi.fn(async () => ({ id: "listing-1", buildingId: "building-2" })) }, "field_capture_listing_mismatch"],
  ])("rejects a %s binding", async (_label, overrides, code) => {
    const deps = dependencies(overrides);
    await expect(startCaptureSessionCore(input, staff, deps)).rejects.toThrow(code);
    expect(deps.writePatch).not.toHaveBeenCalled();
  });

  it("does not read optional records when their IDs are absent", async () => {
    const deps = dependencies();
    const minimalInput = { ...input };
    delete minimalInput.unitId;
    delete minimalInput.listingId;

    await startCaptureSessionCore(minimalInput, staff, deps);
    expect(deps.readUnit).not.toHaveBeenCalled();
    expect(deps.readListing).not.toHaveBeenCalled();
  });

  it.each([
    ["id", "different-session"],
    ["requestId", "44444444-4444-4444-8444-444444444444"],
    ["buildingId", "building-2"],
    ["unitId", "unit-2"],
    ["listingId", "listing-2"],
    ["visitId", "55555555-5555-4555-8555-555555555555"],
    ["visitType", "initial"],
    ["createdBy", "staff-2"],
  ])("rejects a replay with mismatched session %s", async (field, value) => {
    const deps = dependencies({
      readSession: vi.fn(async () => storedSession({ [field]: value })),
      readVisit: vi.fn(async () => storedVisit()),
    });

    await expect(startCaptureSessionCore(input, staff, deps)).rejects.toThrow(
      "field_capture_session_conflict",
    );
    expect(deps.writePatch).not.toHaveBeenCalled();
  });

  it.each([
    ["id", "different-visit"],
    ["buildingId", "building-2"],
    ["unitId", "unit-2"],
    ["listingId", "listing-2"],
    ["type", "initial"],
    ["assignedUserId", "staff-2"],
    ["checklistTemplateId", "initial"],
    ["checklistTemplateVersion", 2],
  ])("rejects a replay with mismatched visit %s", async (field, value) => {
    const deps = dependencies({
      readSession: vi.fn(async () => storedSession()),
      readVisit: vi.fn(async () => storedVisit({ [field]: value })),
    });

    await expect(startCaptureSessionCore(input, staff, deps)).rejects.toThrow(
      "field_capture_visit_conflict",
    );
    expect(deps.writePatch).not.toHaveBeenCalled();
  });

  it("binds a session to the exact visit created by registration", async () => {
    const registrationVisit = storedVisit({
      createdAt: "2026-08-08T23:59:00.000Z",
      updatedAt: "2026-08-08T23:59:00.000Z",
      followUpAction: "keep-this-server-field",
    });
    const deps = dependencies({
      readSession: vi.fn(async () => null),
      readVisit: vi.fn(async () => registrationVisit),
    });

    await expect(startCaptureSessionCore(input, staff, deps)).resolves.toEqual({
      captureSessionId: SESSION_ID,
      visitId: VISIT_ID,
    });
    const patch = vi.mocked(deps.writePatch).mock.calls[0][0];
    expect(patch[`fieldPlatform/visits/${VISIT_ID}`]).toEqual(
      registrationVisit,
    );
  });

  it("rejects an existing session whose visit is missing", async () => {
    const deps = dependencies({
      readSession: vi.fn(async () => storedSession()),
      readVisit: vi.fn(async () => null),
    });

    await expect(startCaptureSessionCore(input, staff, deps)).rejects.toThrow(
      "field_capture_visit_conflict",
    );
    expect(deps.writePatch).not.toHaveBeenCalled();
  });

  it("rejects a noncanonical server timestamp without writing", async () => {
    const deps = dependencies({
      now: vi.fn(() => "2026-08-09T00:00:00Z"),
    });

    await expect(startCaptureSessionCore(input, staff, deps)).rejects.toThrow(
      "field_capture_session_state_invalid",
    );
    expect(deps.writePatch).not.toHaveBeenCalled();
  });
});
