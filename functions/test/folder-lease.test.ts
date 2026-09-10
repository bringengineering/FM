import { describe, expect, it } from "vitest";

import {
  reduceDriveFolderLeaseClaim,
  reduceDriveFolderLeasePublish,
} from "../src/drive/folder-lease.js";

const FIRST_MEDIA_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_MEDIA_ID = "44444444-4444-4444-8444-444444444444";
const THIRD_MEDIA_ID = "66666666-6666-4666-8666-666666666666";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-08-10T03:00:00.000Z";
const LEASE_UNTIL = "2026-08-10T03:05:00.000Z";

const FOLDER_IDS = {
  root: "root-1",
  building: "folder-1",
  unit: "folder-2",
  session: "folder-3",
  representativePhotos: "folder-4",
  originalPhotos: "folder-5",
  verticalVideos: "folder-6",
};

function syncingState() {
  return {
    media: {
      [FIRST_MEDIA_ID]: {
        id: FIRST_MEDIA_ID,
        buildingId: "building-1",
        captureSessionId: SESSION_ID,
      },
      [SECOND_MEDIA_ID]: {
        id: SECOND_MEDIA_ID,
        buildingId: "building-1",
        captureSessionId: SESSION_ID,
      },
      [THIRD_MEDIA_ID]: {
        id: THIRD_MEDIA_ID,
        buildingId: "building-2",
        captureSessionId: "77777777-7777-4777-8777-777777777777",
      },
    },
    driveSyncJobs: {
      [FIRST_MEDIA_ID]: {
        id: FIRST_MEDIA_ID,
        mediaId: FIRST_MEDIA_ID,
        status: "syncing",
        leaseOwner: "worker-1",
        leaseToken: "lease-1",
        leaseUntil: LEASE_UNTIL,
      },
      [SECOND_MEDIA_ID]: {
        id: SECOND_MEDIA_ID,
        mediaId: SECOND_MEDIA_ID,
        status: "syncing",
        leaseOwner: "worker-2",
        leaseToken: "lease-2",
        leaseUntil: LEASE_UNTIL,
      },
      [THIRD_MEDIA_ID]: {
        id: THIRD_MEDIA_ID,
        mediaId: THIRD_MEDIA_ID,
        status: "syncing",
        leaseOwner: "worker-3",
        leaseToken: "lease-3",
        leaseUntil: LEASE_UNTIL,
      },
    },
  };
}

function claimInput(
  mediaId = FIRST_MEDIA_ID,
  workerId = "worker-1",
  leaseToken = "lease-1",
  now = NOW,
) {
  return {
    mediaId,
    workerId,
    leaseToken,
    now,
    rootFolderId: "root-1",
  };
}

describe("distributed Drive folder lease and cache", () => {
  it("fences the same building/session while allowing unrelated sessions", () => {
    const first = reduceDriveFolderLeaseClaim(syncingState(), claimInput());

    expect(first).toMatchObject({ status: "acquired", write: true });
    expect(first.state).toHaveProperty(
      `driveFolderLeases.building-1.${SESSION_ID}.mediaId`,
      FIRST_MEDIA_ID,
    );

    const sameSession = reduceDriveFolderLeaseClaim(first.state, claimInput(
      SECOND_MEDIA_ID,
      "worker-2",
      "lease-2",
    ));
    expect(sameSession).toMatchObject({ status: "busy", write: false });

    const otherListing = structuredClone(first.state) as Record<string, any>;
    const otherSessionId = "55555555-5555-4555-8555-555555555555";
    otherListing.media[SECOND_MEDIA_ID].captureSessionId = otherSessionId;
    const otherSession = reduceDriveFolderLeaseClaim(otherListing, claimInput(
      SECOND_MEDIA_ID,
      "worker-2",
      "lease-2",
    ));
    expect(otherSession).toMatchObject({ status: "acquired", write: true });
    expect(otherSession.state).toHaveProperty(
      `driveFolderLeases.building-1.${otherSessionId}.mediaId`,
      SECOND_MEDIA_ID,
    );

    const otherBuildingSessionId =
      "77777777-7777-4777-8777-777777777777";
    const otherBuilding = reduceDriveFolderLeaseClaim(first.state, claimInput(
      THIRD_MEDIA_ID,
      "worker-3",
      "lease-3",
    ));
    expect(otherBuilding).toMatchObject({ status: "acquired", write: true });
    expect(otherBuilding.state).toHaveProperty(
      `driveFolderLeases.building-2.${otherBuildingSessionId}.mediaId`,
      THIRD_MEDIA_ID,
    );
  });

  it("publishes one canonical cache, releases the lease, and reuses it", () => {
    const claimed = reduceDriveFolderLeaseClaim(syncingState(), claimInput());
    const published = reduceDriveFolderLeasePublish(claimed.state, {
      ...claimInput(),
      folderIds: FOLDER_IDS,
      publishedAt: "2026-08-10T03:00:05.000Z",
    });

    expect(published).toMatchObject({
      status: "committed",
      write: true,
      folderIds: FOLDER_IDS,
    });
    expect(published.state).toHaveProperty(
      `driveFolderCaches.building-1.${SESSION_ID}.folderIds`,
      FOLDER_IDS,
    );
    expect(published.state).not.toHaveProperty(
      `driveFolderLeases.building-1.${SESSION_ID}`,
    );

    expect(reduceDriveFolderLeasePublish(published.state, {
      ...claimInput(),
      folderIds: FOLDER_IDS,
      publishedAt: "2026-08-10T03:00:05.000Z",
    })).toMatchObject({
      status: "alreadyCached",
      write: false,
      folderIds: FOLDER_IDS,
    });

    const reused = reduceDriveFolderLeaseClaim(published.state, claimInput(
      SECOND_MEDIA_ID,
      "worker-2",
      "lease-2",
      "2026-08-10T03:00:06.000Z",
    ));
    expect(reused).toMatchObject({
      status: "cached",
      write: false,
      folderIds: FOLDER_IDS,
    });
  });

  it("lets a new fenced job steal only an expired folder lease", () => {
    const claimed = reduceDriveFolderLeaseClaim(syncingState(), claimInput());
    const state = structuredClone(claimed.state) as Record<string, any>;
    state.driveSyncJobs[SECOND_MEDIA_ID].leaseUntil =
      "2026-08-10T03:10:01.000Z";

    const stolen = reduceDriveFolderLeaseClaim(state, claimInput(
      SECOND_MEDIA_ID,
      "worker-2",
      "lease-2",
      "2026-08-10T03:05:01.000Z",
    ));
    expect(stolen).toMatchObject({ status: "acquired", write: true });
    expect(stolen.state).toHaveProperty(
      `driveFolderLeases.building-1.${SESSION_ID}.mediaId`,
      SECOND_MEDIA_ID,
    );

    expect(reduceDriveFolderLeasePublish(stolen.state, {
      ...claimInput(),
      folderIds: FOLDER_IDS,
      publishedAt: "2026-08-10T03:05:02.000Z",
    })).toMatchObject({ status: "staleLease", write: false });
  });
});
