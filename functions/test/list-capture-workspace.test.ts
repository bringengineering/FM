import { describe, expect, it, vi } from "vitest";

import {
  listCaptureWorkspaceCore,
  type ListCaptureWorkspaceDependencies,
} from "../src/field/list-capture-workspace.js";

const SESSION_MANAGEMENT = "11111111-1111-4111-8111-111111111111";
const SESSION_ADVERTISING = "22222222-2222-4222-8222-222222222222";
const SESSION_UNASSIGNED = "33333333-3333-4333-8333-333333333333";

function dependencies(
  overrides: Partial<ListCaptureWorkspaceDependencies> = {},
): ListCaptureWorkspaceDependencies {
  return {
    listAssignedBuildingIds: vi.fn(async () => ["b1", "b3", "b4"]),
    listBuildings: vi.fn(async () => [
      {
        id: "b1",
        name: "Alpha 관리",
        managementContract: { status: "active" },
        privateOwnerPhone: "must-not-leak",
      },
      {
        id: "b2",
        name: "Beta 미배정",
        managementContract: { status: "active" },
      },
      {
        id: "b3",
        name: "Gamma 광고전용",
        managementContract: { status: "paused" },
      },
      {
        id: "b4",
        name: "Delta 건물전체",
        managementContract: { status: "active" },
      },
    ]),
    listUnits: vi.fn(async () => [
      { id: "u1", buildingId: "b1", unitLabel: "201호", secret: "omit" },
      { id: "u1", buildingId: "b1", unitLabel: "201호" },
      { id: "u2", buildingId: "b2", unitLabel: "302호" },
    ]),
    listListings: vi.fn(async () => [
      {
        id: "l1",
        buildingId: "b1",
        unitId: "u1",
        unitLabel: "201호",
        status: "capturing",
        depositWon: 10_000_000,
      },
      {
        id: "l1",
        buildingId: "b1",
        unitId: "u1",
        unitLabel: "201호",
        status: "capturing",
      },
      {
        id: "closed-l2",
        buildingId: "b1",
        unitId: "u1",
        unitLabel: "201호",
        status: "closed",
      },
      {
        id: "unassigned-l3",
        buildingId: "b2",
        unitId: "u2",
        unitLabel: "302호",
        status: "advertising",
      },
      {
        id: "l4",
        buildingId: "b3",
        unitId: "u4",
        unitLabel: "401호",
        status: "draft",
      },
    ]),
    listCaptureSessions: vi.fn(async () => [
      {
        id: SESSION_MANAGEMENT,
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        buildingId: "b1",
        unitId: "u1",
        visitId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        createdBy: "staff-1",
        status: "open",
        createdAt: "2026-08-09T08:00:00.000Z",
        updatedAt: "2026-08-09T08:30:00.000Z",
        internalNote: "must-not-leak",
      },
      {
        id: SESSION_ADVERTISING,
        requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        buildingId: "b1",
        unitId: "u1",
        listingId: "l1",
        visitId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        createdBy: "staff-1",
        status: "open",
        createdAt: "2026-08-09T09:00:00.000Z",
        updatedAt: "2026-08-09T09:30:00.000Z",
      },
      {
        id: SESSION_UNASSIGNED,
        requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        buildingId: "b2",
        unitId: "u2",
        listingId: "unassigned-l3",
        visitId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        createdBy: "staff-1",
        status: "open",
        createdAt: "2026-08-09T10:00:00.000Z",
        updatedAt: "2026-08-09T10:00:00.000Z",
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        requestId: "55555555-5555-4555-8555-555555555555",
        buildingId: "b1",
        unitId: "u1",
        visitId: "66666666-6666-4666-8666-666666666666",
        createdBy: "other-staff",
        status: "open",
        createdAt: "2026-08-09T11:00:00.000Z",
        updatedAt: "2026-08-09T11:00:00.000Z",
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        requestId: "88888888-8888-4888-8888-888888888888",
        buildingId: "b1",
        unitId: "u1",
        visitId: "99999999-9999-4999-8999-999999999999",
        createdBy: "staff-1",
        status: "complete",
        createdAt: "2026-08-09T12:00:00.000Z",
        updatedAt: "2026-08-09T12:00:00.000Z",
      },
    ]),
    ...overrides,
  };
}

describe("listCaptureWorkspaceCore", () => {
  it("returns no workspace data for reviewers without reading business records", async () => {
    const deps = dependencies();

    await expect(listCaptureWorkspaceCore(
      { uid: "reviewer-1", role: "reviewer" },
      deps,
    )).resolves.toEqual({ targets: [], openSessions: [] });

    expect(deps.listAssignedBuildingIds).not.toHaveBeenCalled();
    expect(deps.listBuildings).not.toHaveBeenCalled();
    expect(deps.listUnits).not.toHaveBeenCalled();
    expect(deps.listListings).not.toHaveBeenCalled();
    expect(deps.listCaptureSessions).not.toHaveBeenCalled();
  });

  it("keeps staff management and advertising targets separate and assignment-scoped", async () => {
    const result = await listCaptureWorkspaceCore(
      { uid: "staff-1", role: "staff" },
      dependencies(),
    );

    expect(result.targets).toEqual([
      {
        id: "management:b1:u1",
        buildingId: "b1",
        buildingName: "Alpha 관리",
        unitId: "u1",
        unitLabel: "201호",
        source: "management",
      },
      {
        id: "management:b4:building",
        buildingId: "b4",
        buildingName: "Delta 건물전체",
        source: "management",
      },
      {
        id: "advertising:l1",
        buildingId: "b1",
        buildingName: "Alpha 관리",
        unitId: "u1",
        unitLabel: "201호",
        listingId: "l1",
        source: "advertising",
      },
      {
        id: "advertising:l4",
        buildingId: "b3",
        buildingName: "Gamma 광고전용",
        unitId: "u4",
        unitLabel: "401호",
        listingId: "l4",
        source: "advertising",
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /privateOwnerPhone|depositWon|secret|unassigned-l3|closed-l2/,
    );
  });

  it("returns only the actor's open sessions that match returned targets, newest first", async () => {
    const result = await listCaptureWorkspaceCore(
      { uid: "staff-1", role: "staff" },
      dependencies(),
    );

    expect(result.openSessions.map((session) => session.id)).toEqual([
      SESSION_ADVERTISING,
      SESSION_MANAGEMENT,
    ]);
    expect(result.openSessions[0]).toEqual({
      id: SESSION_ADVERTISING,
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      buildingId: "b1",
      unitId: "u1",
      listingId: "l1",
      visitId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      createdBy: "staff-1",
      status: "open",
      createdAt: "2026-08-09T09:00:00.000Z",
      updatedAt: "2026-08-09T09:30:00.000Z",
    });
    expect(result.openSessions[1]).not.toHaveProperty("internalNote");
  });

  it("lets admins use all valid buildings without consulting assignments", async () => {
    const deps = dependencies();
    const result = await listCaptureWorkspaceCore(
      { uid: "admin-1", role: "admin" },
      deps,
    );

    expect(result.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "management:b2:u2", source: "management" }),
      expect.objectContaining({
        id: "advertising:unassigned-l3",
        source: "advertising",
      }),
    ]));
    expect(deps.listAssignedBuildingIds).not.toHaveBeenCalled();
    expect(result.openSessions).toEqual([]);
  });

  it("drops malformed records instead of leaking partial stored state", async () => {
    const deps = dependencies({
      listBuildings: vi.fn(async () => [
        { id: "bad/path", name: "Unsafe", managementContract: { status: "active" } },
        { id: "b1", name: "\u0000", managementContract: { status: "active" } },
      ]),
      listUnits: vi.fn(async () => []),
      listListings: vi.fn(async () => []),
      listCaptureSessions: vi.fn(async () => [{
        id: SESSION_MANAGEMENT,
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        buildingId: "b1",
        visitId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        createdBy: "staff-1",
        status: "open",
        createdAt: "not-an-iso",
        updatedAt: "not-an-iso",
      }]),
    });

    await expect(listCaptureWorkspaceCore(
      { uid: "staff-1", role: "staff" },
      deps,
    )).resolves.toEqual({ targets: [], openSessions: [] });
  });
});
