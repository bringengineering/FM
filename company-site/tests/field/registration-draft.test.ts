import { describe, expect, it, vi } from "vitest";

import {
  REGISTRATION_DRAFT_VERSION,
  activeWizardDraftKey,
  commitPreparedWizardDraft,
  getOrCreateActiveWizardDraftId,
  legacyWizardDraftClaimKey,
  loadWizardDraft,
  migrateRegistrationDraft,
  prepareWizardDraft,
  removeWizardDraft,
  saveWizardDraft,
  toSaveFieldRegistrationInput,
  wizardDraftStorageKey,
} from "../../app/field/lib/registration-draft";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const legacyDraft = {
  building: { name: "legacy building", roadAddress: "Wonju-ro 1" },
  units: [{ localId: "unit-1", unitLabel: "201", structure: "", floor: "" }],
  listing: { maintenanceFeeWon: 0 },
  addressVerified: true,
  duplicateBuilding: null,
};

describe("wizard draft persistence", () => {
  it("reads the old shared draft without claiming it until commit", () => {
    const storage = memoryStorage();
    storage.setItem("bring-field-building-draft", JSON.stringify(legacyDraft));

    const loaded = loadWizardDraft(storage, {
      uid: "staff-a",
      draftId: "new-building",
      legacyKey: "bring-field-building-draft",
      idFactory: () => "generated-request",
      now: () => "2026-08-09T00:00:00.000Z",
    });

    expect(loaded.value.draftVersion).toBe(REGISTRATION_DRAFT_VERSION);
    expect(loaded.ownerUid).toBe("staff-a");
    expect(loaded.value.building.name).toBe("legacy building");
    expect(loaded.value.ownerNoteDrafts).toEqual([]);
    expect(storage.getItem("bring-field-building-draft")).not.toBeNull();
    expect(storage.getItem(wizardDraftStorageKey("staff-a", "new-building"))).toBeNull();
  });

  it("keeps a failed legacy cleanup claimed by one UID across remounts", () => {
    const legacyKey = "bring-field-building-draft";
    const values = new Map<string, string>([[legacyKey, JSON.stringify(legacyDraft)]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => {
        if (key === legacyKey) throw new Error("cleanup failed");
        values.delete(key);
      },
    };
    const preparedA = prepareWizardDraft(storage, {
      uid: "staff-a",
      draftId: "draft-a",
      legacyKey,
      idFactory: () => "request-a",
      now: () => "2026-08-09T01:00:00.000Z",
    });
    preparedA.envelope.value.building.name = "A edited legacy building";

    expect(() => commitPreparedWizardDraft(storage, preparedA, {
      activeUid: "staff-a",
      updatedAt: "2026-08-09T01:01:00.000Z",
    })).toThrow("cleanup failed");
    expect(storage.getItem(legacyWizardDraftClaimKey(legacyKey))).not.toBeNull();

    const restoredA = loadWizardDraft(storage, {
      uid: "staff-a",
      draftId: "draft-a",
      legacyKey,
      idFactory: () => "unused-a",
    });
    expect(restoredA.value.building.name).toBe("A edited legacy building");

    const otherDraftA = loadWizardDraft(storage, {
      uid: "staff-a",
      draftId: "draft-a-other",
      legacyKey,
      idFactory: () => "request-a-other",
    });
    expect(otherDraftA.value.building.name).toBe("");

    const loadedB = loadWizardDraft(storage, {
      uid: "staff-b",
      draftId: "draft-b",
      legacyKey,
      idFactory: () => "request-b",
    });
    expect(loadedB.value.building.name).toBe("");
    expect(storage.getItem(legacyKey)).not.toBeNull();
  });

  it("allows a replaced legacy value with a new fingerprint to be claimed", () => {
    const storage = memoryStorage();
    const legacyKey = "bring-field-building-draft";
    storage.setItem(legacyKey, JSON.stringify(legacyDraft));
    const first = prepareWizardDraft(storage, {
      uid: "staff-a",
      draftId: "draft-a",
      legacyKey,
      idFactory: () => "request-a",
    });
    storage.setItem(legacyWizardDraftClaimKey(legacyKey), JSON.stringify(first.legacyClaim));
    storage.setItem(legacyKey, JSON.stringify({
      ...legacyDraft,
      building: { ...legacyDraft.building, name: "replacement legacy building" },
    }));

    const replacement = prepareWizardDraft(storage, {
      uid: "staff-b",
      draftId: "draft-b",
      legacyKey,
      idFactory: () => "request-b",
    });

    expect(replacement.envelope.value.building.name).toBe("replacement legacy building");
    expect(replacement.legacyClaim).toMatchObject({ ownerUid: "staff-b", draftId: "draft-b" });
  });

  it("keeps a durable tombstone after legacy removal succeeds", () => {
    const legacyKey = "bring-field-building-draft";
    const claimKey = legacyWizardDraftClaimKey(legacyKey);
    const storage = memoryStorage();
    storage.setItem(legacyKey, JSON.stringify(legacyDraft));
    const first = prepareWizardDraft(storage, {
      uid: "staff-a",
      draftId: "draft-a",
      legacyKey,
      idFactory: () => "request-a",
    });

    commitPreparedWizardDraft(storage, first);
    expect(storage.getItem(legacyKey)).toBeNull();
    expect(storage.getItem(claimKey)).not.toBeNull();
    expect(loadWizardDraft(storage, {
      uid: "staff-a",
      draftId: "draft-a",
      legacyKey,
      idFactory: () => "unused",
    }).value.building.name).toBe("legacy building");
    expect(storage.getItem(wizardDraftStorageKey("staff-a", "draft-a"))).not.toBeNull();
  });

  it("rejects a second UID that prepared the same legacy draft before the first commit", () => {
    const storage = memoryStorage();
    const legacyKey = "bring-field-building-draft";
    storage.setItem(legacyKey, JSON.stringify(legacyDraft));
    const preparedA = prepareWizardDraft(storage, {
      uid: "staff-a",
      draftId: "draft-a",
      legacyKey,
      idFactory: () => "request-a",
    });
    const preparedB = prepareWizardDraft(storage, {
      uid: "staff-b",
      draftId: "draft-b",
      legacyKey,
      idFactory: () => "request-b",
    });

    commitPreparedWizardDraft(storage, preparedA, { activeUid: "staff-a" });
    expect(() => commitPreparedWizardDraft(storage, preparedB, { activeUid: "staff-b" }))
      .toThrow("registration_draft_legacy_changed");

    expect(storage.getItem(activeWizardDraftKey("staff-b"))).toBeNull();
    expect(storage.getItem(wizardDraftStorageKey("staff-b", "draft-b"))).toBeNull();
    expect(storage.getItem(legacyWizardDraftClaimKey(legacyKey))).toContain("staff-a");
  });

  it("does not orphan a legacy claim when active-pointer persistence fails", () => {
    const legacyKey = "bring-field-building-draft";
    const activeKey = activeWizardDraftKey("staff-a");
    const values = new Map<string, string>([[legacyKey, JSON.stringify(legacyDraft)]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === activeKey) throw new Error("active pointer failed");
        values.set(key, value);
      },
      removeItem: (key: string) => { values.delete(key); },
    };
    const first = prepareWizardDraft(storage, {
      uid: "staff-a",
      draftId: "draft-a",
      legacyKey,
      idFactory: () => "request-a",
    });

    expect(() => commitPreparedWizardDraft(storage, first, { activeUid: "staff-a" }))
      .toThrow("active pointer failed");
    expect(storage.getItem(legacyWizardDraftClaimKey(legacyKey))).toBeNull();
    expect(storage.getItem(wizardDraftStorageKey("staff-a", "draft-a"))).toBeNull();
    expect(storage.getItem(legacyKey)).not.toBeNull();

    const remount = prepareWizardDraft(storage, {
      uid: "staff-a",
      draftId: "draft-b",
      legacyKey,
      idFactory: () => "request-b",
    });
    expect(remount.envelope.value.building.name).toBe("legacy building");
    expect(remount.legacyClaim).toMatchObject({ ownerUid: "staff-a", draftId: "draft-b" });
  });

  it("does not delete a new legacy value when an unrelated scoped draft exists", () => {
    const storage = memoryStorage();
    const legacyKey = "bring-field-building-draft";
    const initial = prepareWizardDraft(storage, {
      uid: "staff-a",
      draftId: "draft-a",
      idFactory: () => "request-a",
    });
    commitPreparedWizardDraft(storage, initial);
    const replacement = JSON.stringify({
      ...legacyDraft,
      building: { ...legacyDraft.building, name: "new replacement legacy" },
    });
    storage.setItem(legacyKey, replacement);

    const scoped = prepareWizardDraft(storage, {
      uid: "staff-a",
      draftId: "draft-a",
      legacyKey,
      idFactory: () => "unused",
    });
    expect(scoped.legacyClaim).toBeNull();
    commitPreparedWizardDraft(storage, scoped);

    expect(storage.getItem(legacyKey)).toBe(replacement);
    expect(scoped.envelope.value.building.name).toBe("");
  });

  it("aborts a stale prepared migration when the legacy fingerprint changes", () => {
    const storage = memoryStorage();
    const legacyKey = "bring-field-building-draft";
    storage.setItem(legacyKey, JSON.stringify(legacyDraft));
    const stale = prepareWizardDraft(storage, {
      uid: "staff-a",
      draftId: "draft-a",
      legacyKey,
      idFactory: () => "request-a",
    });
    storage.setItem(legacyKey, JSON.stringify({
      ...legacyDraft,
      building: { ...legacyDraft.building, name: "changed before commit" },
    }));

    expect(() => commitPreparedWizardDraft(storage, stale, { activeUid: "staff-a" }))
      .toThrow("registration_draft_legacy_changed");
    expect(storage.getItem(activeWizardDraftKey("staff-a"))).toBeNull();
    expect(storage.getItem(wizardDraftStorageKey("staff-a", "draft-a"))).toBeNull();

    const fresh = prepareWizardDraft(storage, {
      uid: "staff-b",
      draftId: "draft-b",
      legacyKey,
      idFactory: () => "request-b",
    });
    expect(fresh.envelope.value.building.name).toBe("changed before commit");
  });

  it("upgrades the managed-map version-2 draft without changing idempotency IDs", () => {
    const idFactory = vi.fn(() => "unused");
    const migrated = migrateRegistrationDraft({
      ...legacyDraft,
      draftVersion: 2,
      draftId: "draft-existing",
      requestId: "request-existing",
    }, undefined, idFactory);

    expect(migrated).toMatchObject({
      draftVersion: REGISTRATION_DRAFT_VERSION,
      draftId: "draft-existing",
      requestId: "request-existing",
      ownerNoteDrafts: [],
    });
    expect(idFactory).not.toHaveBeenCalled();
  });

  it("preserves the legacy request ID while rebinding the value to its scoped draft key", () => {
    const storage = memoryStorage();
    storage.setItem("bring-field-building-draft", JSON.stringify({
      ...legacyDraft,
      draftVersion: 2,
      draftId: "legacy-shared-draft",
      requestId: "legacy-request",
    }));

    const loaded = loadWizardDraft(storage, {
      uid: "staff-a",
      draftId: "active-scoped-draft",
      legacyKey: "bring-field-building-draft",
      idFactory: () => "unused",
    });

    expect(loaded).toMatchObject({
      ownerUid: "staff-a",
      draftId: "active-scoped-draft",
      value: {
        draftId: "active-scoped-draft",
        requestId: "legacy-request",
      },
    });
  });

  it("never returns another UID's draft after an account switch", () => {
    const storage = memoryStorage();
    const draftA = loadWizardDraft(storage, {
      uid: "staff-a",
      draftId: "new-building",
      idFactory: () => "request-a",
    });
    draftA.value.building.name = "A private building";
    saveWizardDraft(storage, draftA, "2026-08-09T01:00:00.000Z");

    const draftB = loadWizardDraft(storage, {
      uid: "staff-b",
      draftId: "new-building",
      idFactory: () => "request-b",
    });
    expect(draftB.value.building.name).toBe("");
    expect(wizardDraftStorageKey("staff-a", "new-building"))
      .not.toBe(wizardDraftStorageKey("staff-b", "new-building"));
  });

  it("ignores malformed JSON and a scoped envelope owned by another UID", () => {
    const storage = memoryStorage();
    storage.setItem(wizardDraftStorageKey("staff-a", "broken"), "{bad-json");
    expect(loadWizardDraft(storage, {
      uid: "staff-a",
      draftId: "broken",
      idFactory: () => "request-a",
    }).value.building.name).toBe("");

    storage.setItem(wizardDraftStorageKey("staff-b", "new-building"), JSON.stringify({
      ...loadWizardDraft(storage, {
        uid: "staff-a",
        draftId: "new-building",
        idFactory: () => "request-a",
      }),
      ownerUid: "staff-a",
    }));
    expect(loadWizardDraft(storage, {
      uid: "staff-b",
      draftId: "new-building",
      idFactory: () => "request-b",
    }).value.building.name).toBe("");
  });

  it("reuses one active draft ID until completion and creates a new ID afterward", () => {
    const storage = memoryStorage();
    const ids = ["draft-first", "draft-second"];
    const first = getOrCreateActiveWizardDraftId(storage, "staff-a", () => ids.shift()!);
    expect(getOrCreateActiveWizardDraftId(storage, "staff-a", () => "unexpected")).toBe(first);
    removeWizardDraft(storage, "staff-a", first);
    expect(getOrCreateActiveWizardDraftId(storage, "staff-a", () => ids.shift()!))
      .toBe("draft-second");
  });

  it("does not clear an unrelated active pointer when removing a scoped draft", () => {
    const storage = memoryStorage();
    const active = getOrCreateActiveWizardDraftId(storage, "staff-a", () => "draft-active");
    const other = loadWizardDraft(storage, {
      uid: "staff-a",
      draftId: "draft-other",
      idFactory: () => "request-other",
    });
    saveWizardDraft(storage, other);

    removeWizardDraft(storage, "staff-a", "draft-other");

    expect(getOrCreateActiveWizardDraftId(storage, "staff-a", () => "unexpected"))
      .toBe(active);
  });

  it("returns readable legacy data without mutating storage", () => {
    const values = new Map<string, string>();
    const legacyKey = "bring-field-building-draft";
    const stored = JSON.stringify(legacyDraft);
    values.set(legacyKey, stored);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key !== legacyKey) throw new Error("quota");
        values.set(key, value);
      },
      removeItem: (key: string) => { values.delete(key); },
    };

    const loaded = loadWizardDraft(storage, {
      uid: "staff-a",
      draftId: "draft-a",
      legacyKey,
      idFactory: () => "request-a",
    });
    expect(loaded.value.building.name).toBe("legacy building");
    expect(storage.getItem(legacyKey)).toBe(stored);
    expect(storage.getItem(wizardDraftStorageKey("staff-a", "draft-a"))).toBeNull();
  });

  it("keeps only valid notes for the same draft and excludes binary-like values", () => {
    const migrated = migrateRegistrationDraft({
      ...legacyDraft,
      draftId: "draft-notes",
      ownerNoteDrafts: [
        {
          localId: "note_12345678",
          draftId: "draft-notes",
          body: "  valid owner note  ",
          recordedAt: "2026-08-09T01:00:00.000Z",
        },
        {
          localId: "note_87654321",
          draftId: "another-draft",
          body: "cross-draft note",
          recordedAt: "2026-08-09T01:00:00.000Z",
        },
        {
          localId: "note_binary_1",
          draftId: "draft-notes",
          body: "blob:https://bring.example/private-media",
          recordedAt: "2026-08-09T01:00:00.000Z",
        },
      ],
    }, undefined, () => "unused");

    expect(migrated.ownerNoteDrafts).toEqual([
      {
        localId: "note_12345678",
        draftId: "draft-notes",
        body: "  valid owner note  ",
        recordedAt: "2026-08-09T01:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(migrated)).not.toContain("blob:");
  });

  it("projects the persisted envelope without serializing binary fields or erasing prose", () => {
    const storage = memoryStorage();
    const envelope = loadWizardDraft(storage, {
      uid: "staff-a",
      draftId: "draft-binary",
      idFactory: () => "request-binary",
    });
    const longAsciiProse = (
      "owner requested repair before tenant move in and staff should confirm completion "
    ).repeat(8).trim();
    envelope.value.listing.locationNote = longAsciiProse;
    envelope.value.listing.conditionNote = (
      "건물주가 입주 전 수리 완료 여부를 확인해 달라고 요청했습니다. "
    ).repeat(20).trim();
    envelope.value.ownerNoteDrafts = [{
      localId: "note_12345678",
      draftId: "draft-binary",
      body: "valid note",
      recordedAt: "2026-08-09T01:00:00.000Z",
      attachment: new Blob(["private"]),
      clientCreatedAt: "untrusted",
    } as typeof envelope.value.ownerNoteDrafts[number] & {
      attachment: Blob;
      clientCreatedAt: string;
    }];

    saveWizardDraft(storage, envelope, "2026-08-09T02:00:00.000Z");

    const serialized = storage.getItem(wizardDraftStorageKey("staff-a", "draft-binary")) || "";
    const storedNote = JSON.parse(serialized).value.ownerNoteDrafts[0];
    expect(storedNote).toEqual({
      localId: "note_12345678",
      draftId: "draft-binary",
      body: "valid note",
      recordedAt: "2026-08-09T01:00:00.000Z",
    });
    expect(serialized).toContain(longAsciiProse);
    expect(serialized).toContain("건물주가 입주 전 수리 완료 여부");
    expect(serialized).not.toContain("attachment");
    expect(serialized).not.toContain("clientCreatedAt");
  });
});

describe("registration draft migration", () => {
  it("replaces duplicate or unusable unit local IDs deterministically", () => {
    const raw = {
      units: [
        { localId: "unit-1", unitLabel: "201호" },
        { localId: "unit-1", unitLabel: "202호" },
        { localId: "unit-2", unitLabel: "203호" },
        { localId: " ", unitLabel: "204호" },
      ],
    };

    const draft = migrateRegistrationDraft(raw, undefined, () => "fixed-id");

    expect(draft.units.map((unit) => unit.localId)).toEqual([
      "unit-1",
      "unit-3",
      "unit-2",
      "unit-4",
    ]);
    expect(new Set(draft.units.map((unit) => unit.localId)).size).toBe(draft.units.length);
  });

  it("rejects drafts created by a newer schema version", () => {
    let thrown: unknown;

    try {
      migrateRegistrationDraft({ draftVersion: 4 }, undefined, () => "unused-id");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      name: "RegistrationDraftCompatibilityError",
      code: "registration_draft_future_version",
      draftVersion: 4,
    });
  });

  it("removes binary URL and realistic bare base64 strings without erasing short text", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const blobUrl = "blob:https://bring.example/12345678-1234-1234-1234-123456789abc";
    const bareBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGsAAAAASUVORK5CYII=";
    const draft = migrateRegistrationDraft({
      building: {
        managementNumber: "BR0001",
        name: "BRING2026",
        purpose: dataUrl,
        jibunAddress: blobUrl,
      },
      units: [{ localId: "unit-1", unitLabel: "QUJD" }],
      listing: { locationNote: bareBase64 },
    }, undefined, () => "fixed-id");

    expect(draft.building).toMatchObject({
      managementNumber: "BR0001",
      name: "BRING2026",
      purpose: "",
      jibunAddress: "",
    });
    expect(draft.units[0].unitLabel).toBe("QUJD");
    expect(draft.listing.locationNote).toBe("");

    const serializedInput = JSON.stringify(toSaveFieldRegistrationInput(draft));
    expect(serializedInput).not.toContain(dataUrl);
    expect(serializedInput).not.toContain(blobUrl);
    expect(serializedInput).not.toContain(bareBase64);
  });

  it("rejects short and long bare binary magic strings but preserves long ASCII prose", () => {
    const shortPngPayload = "iVBORw0KGgoAAAANSUhE";
    const longJpegPayload = `/9j/${"A".repeat(300)}`;
    const lowDiversityIdentifier = "A".repeat(300);
    const longAsciiProse = (
      "owner asked staff to confirm parking access and repair the entrance before move in "
    ).repeat(8).trim();

    const draft = migrateRegistrationDraft({
      building: {
        managementNumber: lowDiversityIdentifier,
        purpose: shortPngPayload,
        jibunAddress: longAsciiProse,
      },
      listing: {
        conditionNote: longJpegPayload,
        locationNote: longAsciiProse,
      },
    }, undefined, () => "fixed-id");

    expect(draft.building.purpose).toBe("");
    expect(draft.listing.conditionNote).toBe("");
    expect(draft.building.managementNumber).toBe(lowDiversityIdentifier);
    expect(draft.building.jibunAddress).toBe(longAsciiProse);
    expect(draft.listing.locationNote).toBe(longAsciiProse);
  });

  it("rejects encoded MP4, QuickTime, WebM, and Ogg capture payloads", () => {
    const mp4Payload = "AAAAGGZ0eXBpc29tAAACAGlzb21pc28y";
    const quickTimePayload = "AAAAGGZ0eXBxdCAgAAAAAHF0ICBtcDQy";
    const webmPayload = "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibQ==";
    const oggPayload = "T2dnUwACAAAAAAAAAABCUklORwAAAAA=";

    const draft = migrateRegistrationDraft({
      building: {
        purpose: mp4Payload,
        jibunAddress: quickTimePayload,
      },
      listing: {
        conditionNote: webmPayload,
        locationNote: oggPayload,
      },
    }, undefined, () => "fixed-id");

    expect(draft.building.purpose).toBe("");
    expect(draft.building.jibunAddress).toBe("");
    expect(draft.listing.conditionNote).toBe("");
    expect(draft.listing.locationNote).toBe("");
  });

  it("rejects Blob and File objects from string fields", () => {
    const draft = migrateRegistrationDraft({
      building: {
        name: new Blob(["private binary"]),
        purpose: new File(["private binary"], "private.jpg", { type: "image/jpeg" }),
      },
    }, undefined, () => "fixed-id");

    expect(draft.building.name).toBe("");
    expect(draft.building.purpose).toBe("");
  });

  it("preserves address coordinates and defaults management contract fields", () => {
    const raw = {
      building: {
        managementNumber: "BR-0001",
        name: "테스트 빌딩",
        roadAddress: "강원특별자치도 원주시 서원대로 1",
        latitude: 37.3422,
        longitude: 127.9202,
      },
      units: [
        { localId: "unit-1", unitLabel: "201호", structure: "원룸", floor: 2 },
      ],
      listing: {
        depositWon: 3_000_000,
        monthlyRentWon: 350_000,
        maintenanceFeeWon: 0,
      },
      addressVerified: true,
      duplicateBuilding: null,
    };

    expect(migrateRegistrationDraft(raw, undefined, () => "fixed-id")).toMatchObject({
      draftVersion: REGISTRATION_DRAFT_VERSION,
      draftId: "fixed-id",
      requestId: "fixed-id",
      building: {
        managementNumber: "BR-0001",
        name: "테스트 빌딩",
        roadAddress: "강원특별자치도 원주시 서원대로 1",
        latitude: 37.3422,
        longitude: 127.9202,
        managementContractRequested: false,
        managementStartedOn: "",
      },
      units: [
        { localId: "unit-1", unitLabel: "201호", structure: "원룸", floor: 2 },
      ],
      listing: {
        depositWon: 3_000_000,
        monthlyRentWon: 350_000,
        maintenanceFeeWon: 0,
      },
      addressVerified: true,
      duplicateBuilding: null,
    });
  });

  it("converts a version 2 draft into the callable save input", () => {
    const draft = migrateRegistrationDraft({
      draftVersion: 2,
      draftId: "draft-12345678",
      requestId: "request-12345678",
      building: {
        managementNumber: " BR-0001 ",
        name: " 테스트 빌딩 ",
        roadAddress: " 강원특별자치도 원주시 서원대로 1 ",
        latitude: 37.3422,
        longitude: 127.9202,
        managementContractRequested: true,
        managementStartedOn: "2026-08-09",
      },
      units: [
        { localId: "unit-1", unitLabel: " 201호 ", structure: " 원룸 ", floor: 2 },
      ],
      listing: {
        depositWon: 3_000_000,
        monthlyRentWon: 350_000,
        maintenanceFeeWon: 0,
        maintenanceFeeItems: " 수도, 인터넷, ",
        locationNote: " 터미널 인근 ",
      },
      addressVerified: true,
      duplicateBuilding: null,
    });

    const input = toSaveFieldRegistrationInput(draft);

    expect(input).toMatchObject({
      requestId: "request-12345678",
      draftId: "draft-12345678",
      building: {
        managementNumber: "BR-0001",
        name: "테스트 빌딩",
        roadAddress: "강원특별자치도 원주시 서원대로 1",
        latitude: 37.3422,
        longitude: 127.9202,
      },
      units: [
        { localId: "unit-1", unitLabel: "201호", structure: "원룸", floor: 2 },
      ],
      listing: {
        maintenanceFeeItems: ["수도", "인터넷"],
        locationDescription: "터미널 인근",
      },
      primaryUnitLocalId: "unit-1",
      managementContract: { requested: true, startedOn: "2026-08-09" },
      ownerNoteDrafts: [],
    });
    expect(input.managementContract).not.toHaveProperty("status");
  });

  it("fails deliberately when projecting a draft without units", () => {
    const draft = migrateRegistrationDraft({}, undefined, () => "fixed-id");
    draft.units = [];

    expect(() => toSaveFieldRegistrationInput(draft))
      .toThrowError("registration_draft_units_required");
  });
});
