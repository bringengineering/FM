# BRING Field Owner Notes and Wizard UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add UID-isolated, append-only landlord notes to every building-registration step and replace the moving wizard footer with a keyboard-safe fixed action dock.

**Architecture:** Propagate the authenticated `FieldSession` through a keyed React context, store each registration draft in a versioned UID/draft-scoped envelope, and keep one controlled `OwnerNotesPanel` mounted above all seven wizard steps. Initial notes are committed atomically by the managed-map plan's `saveFieldRegistrationCore`; later notes and administrator archival use server-stamped callables, while Realtime Database rules keep the note collection client read-only. A small Visual Viewport adapter drives CSS variables so the fixed action dock clears the mobile navigation, iPhone safe area, and on-screen keyboard.

**Tech Stack:** React 19, TypeScript 5.9, Vinext/Vite, Firebase Authentication, Firebase Functions v2 callable functions, Firebase Realtime Database, Vitest, Testing Library, Firebase Emulator Suite, CSS Visual Viewport/safe-area integration.

---

## Required predecessor and execution boundary

This plan is the second implementation slice. Execute the managed-map implementation plan first and begin this plan only after that slice provides all of the following:

- `company-site/app/field/lib/field-api.client.ts` exporting `saveFieldRegistration`.
- `functions/src/field/save-field-registration.ts` exporting `saveFieldRegistrationCore`.
- `company-site/tests/field/field-api.test.ts` and `functions/test/save-field-registration.test.ts` passing.
- This callable input contract:

```ts
export interface SaveFieldRegistrationInput {
  requestId: string;
  draftId: string;
  building: BuildingDraftPayload;
  units: UnitDraftPayload[];
  listing: ListingDraftPayload;
  primaryUnitLocalId: string;
  managementContract: ManagementContractDraft;
  ownerNoteDrafts?: OwnerNoteDraftInput[];
}

export interface OwnerNoteDraftInput {
  localId: string;
  body: string;
  recordedAt: string;
}

export interface SaveFieldRegistrationResult {
  buildingId: string;
  unitIds: Record<string, string>;
  listingId: string;
  visitId: string;
}
```

Run this read-only gate from the repository root:

```powershell
Test-Path company-site/app/field/lib/field-api.client.ts
Test-Path functions/src/field/save-field-registration.ts
rg -n "saveFieldRegistration|saveFieldRegistrationCore|unitIds: Record" company-site/app/field/lib/field-api.client.ts functions/src/field/save-field-registration.ts
pnpm --dir company-site exec vitest run tests/field/field-api.test.ts
pnpm --dir functions exec vitest run test/save-field-registration.test.ts
```

Expected: both `Test-Path` calls print `True`, `rg` finds the four shared symbols, and both focused test commands exit 0. If any check fails, finish the managed-map slice before changing owner-note or wizard files. Do not duplicate registration saving in this plan.

## File structure

### Files created by this plan

- `company-site/app/field/components/FieldSessionContext.tsx` — keyed authenticated-session provider and strict consumer hook.
- `company-site/app/field/components/OwnerNotesPanel.tsx` — persistent/collapsible note composer, recent history, and save-state UI.
- `company-site/app/field/lib/registration-draft.ts` — predecessor-created canonical registration draft, extended to version 3 with owner notes and UID-scoped persistence.
- `company-site/app/field/lib/visual-viewport.ts` — testable keyboard-inset calculation and document CSS-variable binding.
- `company-site/tests/field/registration-draft.test.ts` — predecessor tests extended with migration, malformed-storage, and account-isolation cases.
- `company-site/tests/field/visual-viewport.test.ts` — virtual-keyboard inset and cleanup tests.
- `functions/src/field/owner-notes.ts` — note validation, deterministic IDs, append idempotency, authorization, and archive policy.
- `functions/test/owner-notes.test.ts` — pure server note-policy tests.

### Existing or predecessor-created files modified by this plan

- `company-site/app/field/components/AuthGate.tsx` — mount `FieldSessionProvider` keyed by UID.
- `company-site/app/field/FieldApp.tsx` — consume the propagated session and pass it to the wizard.
- `company-site/app/field/components/BuildingWizard.tsx` — use scoped drafts, mount the note panel once, submit note drafts, and render a two-button fixed dock.
- `company-site/app/field/lib/types.ts` — add `OwnerNote` and `OwnerNoteDraft` domain records.
- `company-site/app/field/lib/field-api.client.ts` — append/archive callable wrappers and authorized note subscription.
- `company-site/app/field/field.css` — sticky note panel, fixed action dock, responsive widths, safe area, and keyboard state.
- `company-site/tests/field/components.test.tsx` — session propagation, persistent panel, note behavior, and stable dock assertions.
- `company-site/tests/field/field-api.test.ts` — callable payload and latest-first note subscription tests.
- `functions/src/field/save-field-registration.ts` — validate and atomically include initial notes in registration updates.
- `functions/src/index.ts` — export `appendOwnerNote` and `archiveOwnerNote` callable functions.
- `functions/test/save-field-registration.test.ts` — initial-note stamping and idempotency coverage.
- `database.rules.json` — assigned-user/admin note reads, index, and server-only writes.
- `company-site/tests/field/database-rules.test.ts` — assigned/unassigned/reviewer/admin read and client-write denial coverage.

## Data and UI invariants

- `fieldPlatform/ownerNotes/{buildingId}/{localId}` is the canonical note path; `localId` is also the retry/idempotency key.
- Clients never set `createdAt`, `createdBy`, `createdByName`, `archivedAt`, or `archivedBy`.
- Note text is normalized once with `trim()`, must contain 1–2,000 characters, and is immutable after creation.
- `recordedAt` is the device event time; `createdAt` is a trusted server time. The UI labels a note as recorded offline when those values differ by more than five minutes.
- A staff user may read and append only for an assigned building. A reviewer may not read or append. An administrator may read, append, and archive.
- A registration draft key always contains both the authenticated UID and `draftId`. Switching accounts remounts the protected subtree before the new UID's draft is loaded.
- The old shared key is claimed exactly once by the first authenticated session after upgrade, rewritten as version 3 under that UID, and removed before the wizard renders. Subsequent accounts cannot read it.
- The note panel is rendered outside the step conditionals, immediately between the wizard header and progress card, so changing steps never unmounts it.
- The action dock always contains exactly two button slots: disabled `이전` on step 1 and one primary `다음 단계`/`등록 내용 저장` action. Address verification remains inside step 1.

### Task 1: Propagate and isolate the authenticated field session

**Files:**
- Create: `company-site/app/field/components/FieldSessionContext.tsx`
- Modify: `company-site/app/field/components/AuthGate.tsx:3-112`
- Test: `company-site/tests/field/components.test.tsx:152-193`

- [ ] **Step 1: Write the failing provider and account-switch test**

Add `act` to the Testing Library import and add this probe/test to `components.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useFieldSession } from "../../app/field/components/FieldSessionContext";
import type { FieldSessionListener } from "../../app/field/lib/auth.client";

function SessionProbe() {
  const session = useFieldSession();
  return <p>{session.uid}:{session.displayName}:{session.role}</p>;
}

it("propagates the authenticated session and replaces the subtree on account switch", async () => {
  let emit: FieldSessionListener = () => undefined;
  render(
    <AuthGate observeSession={(listener) => { emit = listener; return () => undefined; }}>
      <SessionProbe />
    </AuthGate>,
  );

  await act(async () => emit({ uid: "staff-a", displayName: "직원 A", role: "staff" }));
  expect(screen.getByText("staff-a:직원 A:staff")).toBeInTheDocument();

  await act(async () => emit({ uid: "admin-b", displayName: "관리자 B", role: "admin" }));
  expect(screen.queryByText("staff-a:직원 A:staff")).not.toBeInTheDocument();
  expect(screen.getByText("admin-b:관리자 B:admin")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/components.test.tsx -t "propagates the authenticated session"
```

Expected: FAIL because `FieldSessionContext.tsx` and `useFieldSession` do not exist.

- [ ] **Step 3: Add the strict context and keyed provider**

Create `FieldSessionContext.tsx` with this complete implementation:

```tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { FieldSession } from "../lib/auth.client";

const FieldSessionContext = createContext<FieldSession | null>(null);

export function FieldSessionProvider({
  session,
  children,
}: {
  session: FieldSession;
  children: ReactNode;
}) {
  return (
    <FieldSessionContext.Provider value={session}>
      {children}
    </FieldSessionContext.Provider>
  );
}

export function useFieldSession(): FieldSession {
  const session = useContext(FieldSessionContext);
  if (!session) throw new Error("field_session_provider_required");
  return session;
}
```

Import `FieldSessionProvider` into `AuthGate.tsx` and replace its authenticated branch with:

```tsx
if (state.status === "authenticated") {
  return (
    <FieldSessionProvider key={state.session.uid} session={state.session}>
      {children}
    </FieldSessionProvider>
  );
}
```

The `key` is required: it disposes all account-scoped component state before the next UID's children mount.

- [ ] **Step 4: Run the session and existing authentication tests**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/components.test.tsx -t "AuthGate|propagates the authenticated session"
pnpm --dir company-site exec vitest run tests/field/auth.test.ts
```

Expected: all selected tests PASS; unauthenticated children remain hidden and both session transitions render the expected UID.

- [ ] **Step 5: Commit the session boundary**

```bash
git add company-site/app/field/components/FieldSessionContext.tsx company-site/app/field/components/AuthGate.tsx company-site/tests/field/components.test.tsx
git commit -m "feat(field): propagate authenticated staff session"
```

### Task 2: Extend the canonical registration draft with UID-scoped persistence

**Files:**
- Modify: `company-site/app/field/lib/registration-draft.ts`
- Modify: `company-site/tests/field/registration-draft.test.ts`
- Modify: `company-site/app/field/components/BuildingWizard.tsx:27-129,163-197`

- [ ] **Step 1: Write failing migration and isolation tests**

Extend `registration-draft.test.ts` with an in-memory `Storage` substitute and these cases:

```ts
import { describe, expect, it } from "vitest";

import {
  REGISTRATION_DRAFT_VERSION,
  getOrCreateActiveWizardDraftId,
  loadWizardDraft,
  migrateRegistrationDraft,
  removeWizardDraft,
  saveWizardDraft,
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
  building: { name: "레거시 빌딩", roadAddress: "원주시 서원대로 1" },
  units: [{ localId: "unit-1", unitLabel: "201호", structure: "", floor: "" }],
  listing: { maintenanceFeeWon: 0 },
  addressVerified: true,
  duplicateBuilding: null,
};

describe("wizard draft persistence", () => {
  it("migrates the old shared draft once and fills version-3 fields", () => {
    const storage = memoryStorage();
    storage.setItem("bring-field-building-draft", JSON.stringify(legacyDraft));

    const loaded = loadWizardDraft(storage, {
      uid: "staff-a",
      draftId: "new-building",
      legacyKey: "bring-field-building-draft",
    });

    expect(loaded.value.draftVersion).toBe(REGISTRATION_DRAFT_VERSION);
    expect(loaded.ownerUid).toBe("staff-a");
    expect(loaded.value.building.name).toBe("레거시 빌딩");
    expect(loaded.value.ownerNoteDrafts).toEqual([]);
    expect(storage.getItem("bring-field-building-draft")).toBeNull();
  });

  it("upgrades the managed-map version-2 draft without changing idempotency IDs", () => {
    const migrated = migrateRegistrationDraft({
      ...legacyDraft,
      draftVersion: 2,
      draftId: "draft-existing",
      requestId: "request-existing",
    }, undefined, () => "unused");
    expect(migrated).toMatchObject({
      draftVersion: REGISTRATION_DRAFT_VERSION,
      draftId: "draft-existing",
      requestId: "request-existing",
      ownerNoteDrafts: [],
    });
  });

  it("never returns another UID's draft after an account switch", () => {
    const storage = memoryStorage();
    const draftA = loadWizardDraft(storage, { uid: "staff-a", draftId: "new-building" });
    draftA.value.building.name = "A 전용 빌딩";
    saveWizardDraft(storage, draftA, "2026-08-09T01:00:00.000Z");

    const draftB = loadWizardDraft(storage, { uid: "staff-b", draftId: "new-building" });
    expect(draftB.value.building.name).toBe("");
    expect(wizardDraftStorageKey("staff-a", "new-building"))
      .not.toBe(wizardDraftStorageKey("staff-b", "new-building"));
  });

  it("ignores malformed JSON and a scoped envelope owned by another UID", () => {
    const storage = memoryStorage();
    storage.setItem(wizardDraftStorageKey("staff-a", "broken"), "{bad-json");
    expect(loadWizardDraft(storage, { uid: "staff-a", draftId: "broken" }).value.building.name)
      .toBe("");

    storage.setItem(wizardDraftStorageKey("staff-b", "new-building"), JSON.stringify({
      ...loadWizardDraft(storage, { uid: "staff-a", draftId: "new-building" }),
      ownerUid: "staff-a",
    }));
    expect(loadWizardDraft(storage, { uid: "staff-b", draftId: "new-building" }).value.building.name)
      .toBe("");
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
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/registration-draft.test.ts
```

Expected: FAIL because the predecessor module does not yet export UID-scoped load/save helpers or include `ownerNoteDrafts`.

- [ ] **Step 3: Bump and extend the predecessor's canonical draft**

In `registration-draft.ts`, bump the managed-map predecessor version from 2 to 3, import `OwnerNoteDraft`, add `ownerNoteDrafts` to the existing `BuildingWizardDraft`, initialize it in `createRegistrationDraft`, and fill it in `migrateRegistrationDraft`:

```ts
import type { OwnerNoteDraft } from "./types";

export const REGISTRATION_DRAFT_VERSION = 3 as const;
export const LEGACY_WIZARD_DRAFT_KEY = "bring-field-building-draft";

export interface BuildingWizardDraft {
  building: BuildingDraftState;
  units: UnitDraftState[];
  listing: ListingDraftState;
  addressVerified: boolean;
  duplicateBuilding: { id: string; name: string } | null;
  ownerNoteDrafts: OwnerNoteDraft[];
}

export interface StoredRegistrationDraft {
  ownerUid: string;
  draftId: string;
  updatedAt: string;
  value: BuildingWizardDraft;
}

export type RegistrationDraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isOwnerNoteDraft(value: unknown, draftId: string): value is OwnerNoteDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const note = value as Partial<OwnerNoteDraft>;
  return typeof note.localId === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(note.localId) &&
    note.draftId === draftId && typeof note.body === "string" && Boolean(note.body.trim()) &&
    typeof note.recordedAt === "string" && Number.isFinite(Date.parse(note.recordedAt));
}
```

In the existing factory return object add `ownerNoteDrafts: []`. After the existing migration resolves `const draftId`, set `ownerNoteDrafts: Array.isArray(source.ownerNoteDrafts) ? source.ownerNoteDrafts.filter((note) => isOwnerNoteDraft(note, draftId)) : []`. Preserve `draftId` and `requestId` from a valid predecessor draft; generate them only when absent.

Update the predecessor's hardcoded version-2 result expectations to `REGISTRATION_DRAFT_VERSION`; keep version-2 objects only as migration inputs so this upgrade path remains tested.

- [ ] **Step 4: Implement deterministic keying, migration, save, and removal**

Add these functions beneath the draft defaults:

```ts
export function wizardDraftStorageKey(uid: string, draftId: string): string {
  return `bring-field-wizard:v${REGISTRATION_DRAFT_VERSION}:${encodeURIComponent(uid)}:${encodeURIComponent(draftId)}`;
}

export function activeWizardDraftKey(uid: string): string {
  return `bring-field-wizard:active:${encodeURIComponent(uid)}`;
}

export function getOrCreateActiveWizardDraftId(
  storage: RegistrationDraftStorage,
  uid: string,
  idFactory: () => string,
): string {
  const existing = storage.getItem(activeWizardDraftKey(uid));
  if (existing) return existing;
  const created = idFactory();
  storage.setItem(activeWizardDraftKey(uid), created);
  return created;
}

function parseRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function loadWizardDraft(
  storage: RegistrationDraftStorage,
  options: {
    uid: string;
    draftId: string;
    legacyKey?: string;
    initial?: Parameters<typeof createRegistrationDraft>[0];
    idFactory?: Parameters<typeof createRegistrationDraft>[1];
    now?: () => string;
  },
): StoredRegistrationDraft {
  const key = wizardDraftStorageKey(options.uid, options.draftId);
  let generatedId = 0;
  const idFactory = options.idFactory ?? (() => `${options.draftId}-generated-${++generatedId}`);
  const scoped = parseRecord(storage.getItem(key));
  if (
    scoped?.ownerUid === options.uid &&
    scoped.draftId === options.draftId
  ) {
    return {
      ownerUid: options.uid,
      draftId: options.draftId,
      updatedAt: typeof scoped.updatedAt === "string" ? scoped.updatedAt : "",
      value: migrateRegistrationDraft(scoped.value, options.initial, idFactory),
    };
  }

  const legacy = options.legacyKey ? parseRecord(storage.getItem(options.legacyKey)) : null;
  const migrated = migrateRegistrationDraft(legacy, options.initial, idFactory);
  const envelope: StoredRegistrationDraft = {
    ownerUid: options.uid,
    draftId: options.draftId,
    updatedAt: (options.now ?? (() => new Date().toISOString()))(),
    value: { ...migrated, draftVersion: REGISTRATION_DRAFT_VERSION, draftId: options.draftId },
  };
  storage.setItem(key, JSON.stringify(envelope));
  if (legacy && options.legacyKey) storage.removeItem(options.legacyKey);
  return envelope;
}

export function saveWizardDraft(
  storage: RegistrationDraftStorage,
  envelope: StoredRegistrationDraft,
  updatedAt = new Date().toISOString(),
): void {
  storage.setItem(wizardDraftStorageKey(envelope.ownerUid, envelope.draftId), JSON.stringify({
    ...envelope,
    updatedAt,
  }));
}

export function removeWizardDraft(
  storage: RegistrationDraftStorage,
  uid: string,
  draftId: string,
): void {
  storage.removeItem(wizardDraftStorageKey(uid, draftId));
  if (storage.getItem(activeWizardDraftKey(uid)) === draftId) {
    storage.removeItem(activeWizardDraftKey(uid));
  }
}
```

Do not serialize `File`, `Blob`, base64, or `blob:` values into this envelope; the capture plan owns binary persistence.

- [ ] **Step 5: Switch `BuildingWizard` to the envelope without changing its UI yet**

Replace `draftKey` with these injectable props and derive component state from the authenticated UID:

```ts
export interface BuildingWizardProps {
  session: Pick<FieldSession, "uid" | "displayName" | "role">;
  draftId?: string;
  legacyDraftKey?: string;
  storage?: RegistrationDraftStorage;
  now?: () => string;
  idFactory?: Parameters<typeof createRegistrationDraft>[1];
  initialStep?: number;
  initialDraft?: RegistrationDraftInitial;
}
```

Add those fields to the predecessor's existing prop interface without removing `currentPosition`, `checkAddress`, or its typed `onComplete: (input: SaveFieldRegistrationInput) => Promise<SaveFieldRegistrationResult>` callback.

Initialize and save the envelope as follows:

```tsx
const resolvedStorage = storage ?? window.localStorage;
const resolvedIdFactory = idFactory ?? (() => crypto.randomUUID());
const [resolvedDraftId] = useState(() => draftId ?? getOrCreateActiveWizardDraftId(
  resolvedStorage,
  session.uid,
  resolvedIdFactory,
));
const [envelope, setEnvelope] = useState(() => loadWizardDraft(resolvedStorage, {
  uid: session.uid,
  draftId: resolvedDraftId,
  legacyKey: legacyDraftKey ?? LEGACY_WIZARD_DRAFT_KEY,
  initial: initialDraft,
  idFactory: resolvedIdFactory,
  now,
}));
const draft = envelope.value;

useEffect(() => {
  saveWizardDraft(resolvedStorage, envelope, (now ?? (() => new Date().toISOString()))());
  setSaveStatus("로컬 자동저장 완료");
}, [envelope, now, resolvedStorage]);
```

Create one updater and replace every current `setDraft` call with it:

```ts
function updateDraft(updater: (current: BuildingWizardDraft) => BuildingWizardDraft) {
  setEnvelope((current) => ({ ...current, value: updater(current.value) }));
}
```

In production `AuthGate` always mounts the wizard client-side; in tests pass `window.localStorage` or `memoryStorage()` explicitly. The keyed provider from Task 1 is the remount boundary for a changed UID.

- [ ] **Step 6: Run draft, component, and type tests**

Update existing `BuildingWizard` test renders to pass this stable fixture:

```tsx
const staffSession = { uid: "staff-1", displayName: "브링 담당자", role: "staff" as const };
render(<BuildingWizard session={staffSession} draftId="address-check" />);
```

Then run:

```bash
pnpm --dir company-site exec vitest run tests/field/registration-draft.test.ts tests/field/components.test.tsx
pnpm --dir company-site typecheck:field
```

Expected: migration/isolation tests PASS, all pre-existing wizard tests PASS after fixture updates, and TypeScript exits 0.

- [ ] **Step 7: Commit scoped draft persistence**

```bash
git add company-site/app/field/lib/registration-draft.ts company-site/app/field/components/BuildingWizard.tsx company-site/tests/field/registration-draft.test.ts company-site/tests/field/components.test.tsx
git commit -m "feat(field): isolate versioned wizard drafts by user"
```

### Task 3: Define owner-note types and server validation

**Files:**
- Modify: `company-site/app/field/lib/types.ts:1-33,214-238`
- Create: `functions/src/field/owner-notes.ts`
- Create: `functions/test/owner-notes.test.ts`

- [ ] **Step 1: Add the frontend domain records**

Add these interfaces to `types.ts` after `FieldUser`:

```ts
export interface OwnerNote {
  id: EntityId;
  buildingId: EntityId;
  body: string;
  recordedAt: ISODateTime;
  createdAt: ISODateTime;
  createdBy: EntityId;
  createdByName: string;
  archivedAt?: ISODateTime;
  archivedBy?: EntityId;
}

export interface OwnerNoteDraft {
  localId: EntityId;
  draftId: EntityId;
  body: string;
  recordedAt: ISODateTime;
}
```

Extend `AuditEvent["entityType"]` with `"ownerNote"`. Do not add owner notes to `Listing`, map projections, advertising package fields, or Drive description types.

- [ ] **Step 2: Write failing pure server-policy tests**

Create `functions/test/owner-notes.test.ts` with these exact validation cases:

```ts
import { describe, expect, it, vi } from "vitest";

import {
  appendOwnerNoteCore,
  archiveOwnerNoteCore,
  buildOwnerNoteRecord,
  normalizeOwnerNoteDrafts,
  type OwnerNoteDependencies,
} from "../src/field/owner-notes.js";

const NOW = "2026-08-09T02:00:00.000Z";
const actor = {
  uid: "staff-1",
  role: "staff" as const,
  tokenDisplayName: "토큰 이름",
  sessionId: "session-1",
};

function dependencies(overrides: Partial<OwnerNoteDependencies> = {}): OwnerNoteDependencies {
  return {
    nowIso: () => NOW,
    consumeRateLimit: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    buildingExists: vi.fn(async () => true),
    getUserDisplayName: vi.fn(async () => "서버 프로필 이름"),
    isAssigned: vi.fn(async () => true),
    readNote: vi.fn(async () => null),
    createNoteIfAbsent: vi.fn(async (_buildingId, _noteId, note) => note),
    archiveNote: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("owner note policy", () => {
  it("trims valid drafts and rejects empty, oversized, duplicate, or unstable IDs", () => {
    expect(normalizeOwnerNoteDrafts([{ localId: "note_12345678", body: "  수도 확인  ", recordedAt: NOW }]))
      .toEqual([{ localId: "note_12345678", body: "수도 확인", recordedAt: NOW }]);
    expect(() => normalizeOwnerNoteDrafts([{ localId: "note_12345678", body: "   ", recordedAt: NOW }]))
      .toThrow("owner_note_body_required");
    expect(() => normalizeOwnerNoteDrafts([{ localId: "note_12345678", body: "가".repeat(2001), recordedAt: NOW }]))
      .toThrow("owner_note_body_too_long");
    expect(() => normalizeOwnerNoteDrafts([
      { localId: "note_12345678", body: "첫 메모", recordedAt: NOW },
      { localId: "note_12345678", body: "둘째 메모", recordedAt: NOW },
    ])).toThrow("owner_note_id_duplicate");
    expect(() => normalizeOwnerNoteDrafts([{ localId: "bad/key", body: "메모", recordedAt: NOW }]))
      .toThrow("owner_note_id_invalid");
  });

  it("uses only server actor/profile/time fields when building a record", () => {
    expect(buildOwnerNoteRecord({
      buildingId: "building-1",
      draft: { localId: "note_12345678", body: " 전달사항 ", recordedAt: "2026-08-09T01:30:00.000Z" },
      actorUid: "staff-1",
      actorName: "서버 프로필 이름",
      createdAt: NOW,
    })).toEqual({
      id: "note_12345678",
      buildingId: "building-1",
      body: "전달사항",
      recordedAt: "2026-08-09T01:30:00.000Z",
      createdAt: NOW,
      createdBy: "staff-1",
      createdByName: "서버 프로필 이름",
    });
  });

  it("allows assigned staff append idempotently and rejects reviewer append", async () => {
    const deps = dependencies();
    const input = { buildingId: "building-1", localId: "note_12345678", body: "보일러 확인", recordedAt: NOW };
    await expect(appendOwnerNoteCore(input, actor, deps)).resolves.toMatchObject({ id: "note_12345678" });
    expect(deps.createNoteIfAbsent).toHaveBeenCalledOnce();
    await expect(appendOwnerNoteCore(input, { ...actor, role: "reviewer" }, deps))
      .rejects.toThrow("owner_note_forbidden");
  });

  it("allows archival only for administrators", async () => {
    const deps = dependencies({
      readNote: vi.fn(async () => ({
        id: "note_12345678",
        buildingId: "building-1",
        body: "메모",
        recordedAt: NOW,
        createdAt: NOW,
        createdBy: "staff-1",
        createdByName: "담당 직원",
      })),
    });
    await expect(archiveOwnerNoteCore(
      { buildingId: "building-1", noteId: "note_12345678" },
      { uid: "admin-1", role: "admin", tokenDisplayName: "관리자" },
      deps,
    )).resolves.toEqual({ archivedAt: NOW, archivedBy: "admin-1" });
    await expect(archiveOwnerNoteCore(
      { buildingId: "building-1", noteId: "note_12345678" },
      actor,
      deps,
    )).rejects.toThrow("owner_note_archive_forbidden");
  });
});
```

- [ ] **Step 3: Run the server test and verify it fails**

Run:

```bash
pnpm --dir functions exec vitest run test/owner-notes.test.ts
```

Expected: FAIL because `functions/src/field/owner-notes.ts` does not exist.

- [ ] **Step 4: Implement normalization and immutable record construction**

Create `owner-notes.ts` with these exported contracts and pure functions:

```ts
export type FieldRole = "admin" | "staff" | "reviewer";

export interface OwnerNoteDraftInput {
  localId: string;
  body: string;
  recordedAt: string;
}

export interface OwnerNoteRecord {
  id: string;
  buildingId: string;
  body: string;
  recordedAt: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  archivedAt?: string;
  archivedBy?: string;
}

export interface OwnerNoteActor {
  uid: string;
  role: FieldRole;
  tokenDisplayName?: string;
  sessionId?: string;
}

export interface OwnerNoteDependencies {
  nowIso(): string;
  consumeRateLimit(
    uid: string,
    sessionId: string,
    action: "append" | "archive",
    limit: number,
  ): Promise<boolean>;
  isEnabled(uid: string): Promise<boolean>;
  buildingExists(buildingId: string): Promise<boolean>;
  getUserDisplayName(uid: string): Promise<string | null>;
  isAssigned(buildingId: string, uid: string): Promise<boolean>;
  readNote(buildingId: string, noteId: string): Promise<OwnerNoteRecord | null>;
  createNoteIfAbsent(
    buildingId: string,
    noteId: string,
    note: OwnerNoteRecord,
  ): Promise<OwnerNoteRecord>;
  archiveNote(
    buildingId: string,
    noteId: string,
    archive: { archivedAt: string; archivedBy: string },
  ): Promise<void>;
}

const STABLE_ID = /^[A-Za-z0-9_-]{8,128}$/;

export function normalizeOwnerNoteDrafts(value: unknown): OwnerNoteDraftInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error("owner_note_drafts_invalid");
  const seen = new Set<string>();
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("owner_note_draft_invalid");
    }
    const source = candidate as Record<string, unknown>;
    const localId = typeof source.localId === "string" ? source.localId : "";
    const body = typeof source.body === "string" ? source.body.trim() : "";
    const recordedAt = typeof source.recordedAt === "string" ? source.recordedAt : "";
    if (!STABLE_ID.test(localId)) throw new Error("owner_note_id_invalid");
    if (seen.has(localId)) throw new Error("owner_note_id_duplicate");
    if (!body) throw new Error("owner_note_body_required");
    if (body.length > 2000) throw new Error("owner_note_body_too_long");
    if (!Number.isFinite(Date.parse(recordedAt))) throw new Error("owner_note_recorded_at_invalid");
    seen.add(localId);
    return { localId, body, recordedAt };
  });
}

export function buildOwnerNoteRecord(input: {
  buildingId: string;
  draft: OwnerNoteDraftInput;
  actorUid: string;
  actorName: string;
  createdAt: string;
}): OwnerNoteRecord {
  const [draft] = normalizeOwnerNoteDrafts([input.draft]);
  return {
    id: draft.localId,
    buildingId: input.buildingId,
    body: draft.body,
    recordedAt: draft.recordedAt,
    createdAt: input.createdAt,
    createdBy: input.actorUid,
    createdByName: input.actorName,
  };
}
```

- [ ] **Step 5: Implement assignment checks, idempotent append, and archive metadata**

Add these functions to the same file:

```ts
async function canAppend(
  buildingId: string,
  actor: OwnerNoteActor,
  dependencies: OwnerNoteDependencies,
): Promise<boolean> {
  if (actor.role === "admin") return true;
  return actor.role === "staff" && dependencies.isAssigned(buildingId, actor.uid);
}

function sameImmutableNote(left: OwnerNoteRecord, right: OwnerNoteRecord): boolean {
  return left.id === right.id && left.buildingId === right.buildingId &&
    left.body === right.body && left.recordedAt === right.recordedAt &&
    left.createdBy === right.createdBy;
}

export async function appendOwnerNoteCore(
  input: { buildingId: string; localId: string; body: string; recordedAt: string },
  actor: OwnerNoteActor,
  dependencies: OwnerNoteDependencies,
): Promise<OwnerNoteRecord> {
  if (!STABLE_ID.test(input.buildingId)) throw new Error("owner_note_building_id_invalid");
  if (!(await dependencies.isEnabled(actor.uid))) throw new Error("owner_note_forbidden");
  if (!(await canAppend(input.buildingId, actor, dependencies))) {
    throw new Error("owner_note_forbidden");
  }
  if (!(await dependencies.buildingExists(input.buildingId))) {
    throw new Error("owner_note_building_not_found");
  }
  if (!(await dependencies.consumeRateLimit(
    actor.uid,
    actor.sessionId ?? "current",
    "append",
    30,
  ))) {
    throw new Error("owner_note_rate_limited");
  }
  const [draft] = normalizeOwnerNoteDrafts([input]);
  const profileName = (await dependencies.getUserDisplayName(actor.uid))?.trim();
  const actorName = profileName || actor.tokenDisplayName?.trim() || "브링 담당자";
  const candidate = buildOwnerNoteRecord({
    buildingId: input.buildingId,
    draft,
    actorUid: actor.uid,
    actorName,
    createdAt: dependencies.nowIso(),
  });
  const existing = await dependencies.readNote(input.buildingId, draft.localId);
  if (existing) {
    if (!sameImmutableNote(existing, candidate)) throw new Error("owner_note_id_conflict");
    return existing;
  }
  const stored = await dependencies.createNoteIfAbsent(input.buildingId, draft.localId, candidate);
  if (!sameImmutableNote(stored, candidate)) throw new Error("owner_note_id_conflict");
  return stored;
}

export async function archiveOwnerNoteCore(
  input: { buildingId: string; noteId: string },
  actor: OwnerNoteActor,
  dependencies: OwnerNoteDependencies,
): Promise<{ archivedAt: string; archivedBy: string }> {
  if (!STABLE_ID.test(input.buildingId)) throw new Error("owner_note_building_id_invalid");
  if (!(await dependencies.isEnabled(actor.uid))) throw new Error("owner_note_archive_forbidden");
  if (actor.role !== "admin") throw new Error("owner_note_archive_forbidden");
  if (!(await dependencies.consumeRateLimit(
    actor.uid,
    actor.sessionId ?? "current",
    "archive",
    20,
  ))) {
    throw new Error("owner_note_rate_limited");
  }
  if (!STABLE_ID.test(input.noteId)) throw new Error("owner_note_id_invalid");
  const existing = await dependencies.readNote(input.buildingId, input.noteId);
  if (!existing) throw new Error("owner_note_not_found");
  if (existing.archivedAt && existing.archivedBy) {
    return { archivedAt: existing.archivedAt, archivedBy: existing.archivedBy };
  }
  const archive = { archivedAt: dependencies.nowIso(), archivedBy: actor.uid };
  await dependencies.archiveNote(input.buildingId, input.noteId, archive);
  return archive;
}
```

The Realtime Database dependency implemented in Task 5 must use a transaction for `createNoteIfAbsent`; the pure core's read is an optimization, not the race-safety mechanism.

- [ ] **Step 6: Run server policy and frontend type checks**

Run:

```bash
pnpm --dir functions exec vitest run test/owner-notes.test.ts
pnpm --dir functions build
pnpm --dir company-site typecheck:field
```

Expected: all owner-note policy tests PASS and both TypeScript builds exit 0.

- [ ] **Step 7: Commit the shared note contract**

```bash
git add company-site/app/field/lib/types.ts functions/src/field/owner-notes.ts functions/test/owner-notes.test.ts
git commit -m "feat(field): define append-only owner note policy"
```

### Task 4: Include initial notes in the atomic registration write

**Files:**
- Modify: `functions/src/field/owner-notes.ts`
- Modify: `functions/src/field/contracts.ts`
- Modify: `functions/src/field/save-field-registration.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/test/save-field-registration.test.ts`

- [ ] **Step 1: Add a failing initial-note registration test**

Extend the predecessor test fixture so its valid input includes:

```ts
ownerNoteDrafts: [
  {
    localId: "note_12345678",
    body: "  현관 비밀번호는 광고에 쓰지 말 것  ",
    recordedAt: "2026-08-09T01:30:00.000Z",
  },
],
```

Make the dependency fixture return `"서버 프로필 이름"` from `getUserDisplayName("staff-1")`, invoke `saveFieldRegistrationCore` with the same authenticated actor used by the predecessor test, and assert the single atomic update contains:

```ts
expect(committedPatch["fieldPlatform/ownerNotes/building-1/note_12345678"])
  .toEqual({
    id: "note_12345678",
    buildingId: "building-1",
    body: "현관 비밀번호는 광고에 쓰지 말 것",
    recordedAt: "2026-08-09T01:30:00.000Z",
    createdAt: "2026-08-09T02:00:00.000Z",
    createdBy: "staff-1",
    createdByName: "서버 프로필 이름",
  });
expect(JSON.stringify(committedPatch["fieldPlatform/mapProjections/building-1"]))
  .not.toMatch(/현관 비밀번호|ownerNote|createdByName/);
```

Retain the predecessor's second-call idempotency test and additionally assert that only one owner-note path exists after the same `draftId`/`requestId` is retried.

- [ ] **Step 2: Run the registration test and verify the compatibility guard fails it**

Run:

```bash
pnpm --dir functions exec vitest run test/save-field-registration.test.ts
```

Expected: FAIL with `field_owner_notes_not_enabled` or with a missing `fieldPlatform/ownerNotes/...` patch, because the managed-map slice intentionally accepts only an empty note list.

- [ ] **Step 3: Add a pure initial-note patch builder**

Add this function to `owner-notes.ts`:

```ts
export async function buildInitialOwnerNotePatch(input: {
  buildingId: string;
  drafts: unknown;
  actor: OwnerNoteActor;
  createdAt: string;
  getUserDisplayName(uid: string): Promise<string | null>;
}): Promise<Record<string, OwnerNoteRecord>> {
  const drafts = normalizeOwnerNoteDrafts(input.drafts);
  const profileName = (await input.getUserDisplayName(input.actor.uid))?.trim();
  const actorName = profileName || input.actor.tokenDisplayName?.trim() || "브링 담당자";
  return Object.fromEntries(drafts.map((draft) => [
    `fieldPlatform/ownerNotes/${input.buildingId}/${draft.localId}`,
    buildOwnerNoteRecord({
      buildingId: input.buildingId,
      draft,
      actorUid: input.actor.uid,
      actorName,
      createdAt: input.createdAt,
    }),
  ]));
}
```

An empty or omitted array returns an empty object. The hard limit of 100 notes per registration is enforced by `normalizeOwnerNoteDrafts`.

- [ ] **Step 4: Extend `saveFieldRegistrationCore` without creating a second commit path**

Import `buildInitialOwnerNotePatch`, `OwnerNoteActor`, and the canonical `OwnerNoteDraftInput` from `owner-notes.ts`. Remove the predecessor's `field_owner_notes_not_enabled` guard. Add this dependency to the existing `SaveFieldRegistrationDependencies` interface:

```ts
getUserDisplayName(uid: string): Promise<string | null>;
```

Extend the predecessor's shared `FieldActor` in `functions/src/field/contracts.ts` with `tokenDisplayName?: string` and `sessionId?: string`. Update its `requireFieldActor` adapter in `functions/src/index.ts` to set `tokenDisplayName` only from `request.auth.token.name` and `sessionId` from `request.auth.token.auth_time`; never accept either from callable data.

After the core has resolved its deterministic `buildingId`, actor, and one trusted ISO timestamp—but before the existing atomic `commitPatch` call—merge initial notes into the same update object:

```ts
const ownerNotePatch = await buildInitialOwnerNotePatch({
  buildingId,
  drafts: input.ownerNoteDrafts,
  actor: {
    uid: actor.uid,
    role: actor.role,
    tokenDisplayName: actor.tokenDisplayName,
  },
  createdAt: nowIso,
  getUserDisplayName: dependencies.getUserDisplayName,
});

Object.assign(patch, ownerNotePatch);
await dependencies.commitPatch(patch);
```

Wire `getUserDisplayName` in the callable's Admin SDK adapter by reading `fieldPlatform/users/{uid}/displayName`; return `null` when absent so the trusted Firebase Auth token name becomes the fallback. Do not accept `createdByName` or `createdAt` anywhere in `SaveFieldRegistrationInput`.

- [ ] **Step 5: Run the registration and note-policy tests**

Run:

```bash
pnpm --dir functions exec vitest run test/save-field-registration.test.ts test/owner-notes.test.ts
pnpm --dir functions build
```

Expected: both suites PASS; the first registration writes one trimmed, server-stamped note in its atomic patch, a retry returns the same registration result, and the server build exits 0.

- [ ] **Step 6: Commit atomic initial notes**

```bash
git add functions/src/field/owner-notes.ts functions/src/field/contracts.ts functions/src/field/save-field-registration.ts functions/src/index.ts functions/test/save-field-registration.test.ts
git commit -m "feat(field): save initial owner notes atomically"
```

### Task 5: Add server-only note callables and the client read adapter

**Files:**
- Modify: `functions/src/field/owner-notes.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/test/owner-notes.test.ts`
- Modify: `company-site/app/field/lib/field-api.client.ts`
- Modify: `company-site/tests/field/field-api.test.ts`

- [ ] **Step 1: Add failing callable-adapter and client-mapping tests**

Extend `owner-notes.test.ts` with a transaction-race case: make `readNote` return `null`, make `createNoteIfAbsent` return a conflicting record with the same ID but another body, and expect `appendOwnerNoteCore` to reject with `owner_note_id_conflict`. Also test that an unassigned staff dependency (`isAssigned: async () => false`) rejects with `owner_note_forbidden` before `createNoteIfAbsent` is called, and that `consumeRateLimit: async () => false` rejects with `owner_note_rate_limited` before a write.

```ts
it("rejects conflicting, unassigned, and rate-limited append attempts before mutation", async () => {
  const input = {
    buildingId: "building-1",
    localId: "note_12345678",
    body: "보일러 확인",
    recordedAt: NOW,
  };
  const conflicting = dependencies({
    createNoteIfAbsent: vi.fn(async (_buildingId, _noteId, note) => ({
      ...note,
      body: "다른 본문",
    })),
  });
  await expect(appendOwnerNoteCore(input, actor, conflicting))
    .rejects.toThrow("owner_note_id_conflict");

  const unassigned = dependencies({ isAssigned: vi.fn(async () => false) });
  await expect(appendOwnerNoteCore(input, actor, unassigned))
    .rejects.toThrow("owner_note_forbidden");
  expect(unassigned.createNoteIfAbsent).not.toHaveBeenCalled();

  const limited = dependencies({ consumeRateLimit: vi.fn(async () => false) });
  await expect(appendOwnerNoteCore(input, actor, limited))
    .rejects.toThrow("owner_note_rate_limited");
  expect(limited.createNoteIfAbsent).not.toHaveBeenCalled();

  const missingBuilding = dependencies({ buildingExists: vi.fn(async () => false) });
  await expect(appendOwnerNoteCore(input, actor, missingBuilding))
    .rejects.toThrow("owner_note_building_not_found");
  expect(missingBuilding.createNoteIfAbsent).not.toHaveBeenCalled();

  await expect(appendOwnerNoteCore({ ...input, buildingId: "bad/path" }, actor, dependencies()))
    .rejects.toThrow("owner_note_building_id_invalid");

  const disabled = dependencies({ isEnabled: vi.fn(async () => false) });
  await expect(appendOwnerNoteCore(input, actor, disabled))
    .rejects.toThrow("owner_note_forbidden");
  expect(disabled.createNoteIfAbsent).not.toHaveBeenCalled();
});
```

Extend `field-api.test.ts` using the Firebase mocks established by the managed-map slice:

```ts
const serverNote = {
  id: "note_12345678",
  buildingId: "building-1",
  body: "수도 확인",
  recordedAt: "2026-08-09T01:30:00.000Z",
  createdAt: "2026-08-09T02:00:00.000Z",
  createdBy: "staff-1",
  createdByName: "담당 직원",
};

it("sends only client-owned fields to appendOwnerNote", async () => {
  callableResult.mockResolvedValue({ data: { note: serverNote } });
  await expect(appendOwnerNote({
    buildingId: "building-1",
    localId: "note_12345678",
    body: "수도 확인",
    recordedAt: "2026-08-09T01:30:00.000Z",
  })).resolves.toEqual(serverNote);
  expect(callableInvoke).toHaveBeenCalledWith({
    buildingId: "building-1",
    localId: "note_12345678",
    body: "수도 확인",
    recordedAt: "2026-08-09T01:30:00.000Z",
  });
  expect(JSON.stringify(callableInvoke.mock.calls[0][0]))
    .not.toMatch(/createdAt|createdBy|createdByName|archivedAt/);
});

it("sorts active subscribed notes by server creation time newest first", () => {
  expect(sortOwnerNotes({
    older: { ...serverNote, id: "older", createdAt: "2026-08-09T01:00:00.000Z" },
    archived: { ...serverNote, id: "archived", archivedAt: "2026-08-09T02:00:00.000Z" },
    newer: { ...serverNote, id: "newer", createdAt: "2026-08-09T03:00:00.000Z" },
  }).map((note) => note.id)).toEqual(["newer", "older"]);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
pnpm --dir functions exec vitest run test/owner-notes.test.ts
pnpm --dir company-site exec vitest run tests/field/field-api.test.ts
```

Expected: FAIL because the callable exports, wrappers, and note sorting/subscription do not exist.

- [ ] **Step 3: Implement Admin SDK dependencies with transaction idempotency**

In `functions/src/index.ts`, create one `OwnerNoteDependencies` adapter backed by the existing `adminDatabase`:

```ts
const ownerNoteDependencies: OwnerNoteDependencies = {
  nowIso: () => new Date().toISOString(),
  async consumeRateLimit(uid, sessionId, action, limit) {
    const safeSessionId = /^\d{1,20}$/.test(sessionId) ? sessionId : "current";
    const rateRef = adminDatabase.ref(
      `fieldPlatform/serverState/rateLimits/ownerNotes/${uid}/${safeSessionId}/${action}`,
    );
    const now = Date.now();
    const result = await rateRef.transaction((current: { windowStartedAt?: number; count?: number } | null) => {
      if (!current || typeof current.windowStartedAt !== "number" || now - current.windowStartedAt >= 60_000) {
        return { windowStartedAt: now, count: 1 };
      }
      const count = typeof current.count === "number" ? current.count : 0;
      return count >= limit ? undefined : { windowStartedAt: current.windowStartedAt, count: count + 1 };
    }, undefined, false);
    return result.committed;
  },
  async buildingExists(buildingId) {
    return (await adminDatabase.ref(`fieldPlatform/buildings/${buildingId}`).get()).exists();
  },
  async isEnabled(uid) {
    return (await adminDatabase.ref(`fieldPlatform/users/${uid}/enabled`).get()).val() === true;
  },
  async getUserDisplayName(uid) {
    const value = (await adminDatabase.ref(`fieldPlatform/users/${uid}/displayName`).get()).val();
    return typeof value === "string" ? value : null;
  },
  async isAssigned(buildingId, uid) {
    return (await adminDatabase
      .ref(`fieldPlatform/buildingAssignments/${buildingId}/${uid}`).get()).val() === true;
  },
  async readNote(buildingId, noteId) {
    return (await adminDatabase
      .ref(`fieldPlatform/ownerNotes/${buildingId}/${noteId}`).get()).val() as OwnerNoteRecord | null;
  },
  async createNoteIfAbsent(buildingId, noteId, note) {
    const noteRef = adminDatabase.ref(`fieldPlatform/ownerNotes/${buildingId}/${noteId}`);
    const result = await noteRef.transaction((current) => current ?? note, undefined, false);
    return result.snapshot.val() as OwnerNoteRecord;
  },
  async archiveNote(buildingId, noteId, archive) {
    await adminDatabase.ref(`fieldPlatform/ownerNotes/${buildingId}/${noteId}`).update(archive);
  },
};
```

The transaction returns an already-created note instead of overwriting it; `appendOwnerNoteCore` then verifies immutable fields match.

- [ ] **Step 4: Export authenticated/App-Check-protected callables**

Reuse the predecessor's async `requireFieldActor(request)`—which checks claims and `users/{uid}/enabled`—and add the two exports to `functions/src/index.ts`:

```ts
export const appendOwnerNote = onCall(
  { region: "asia-northeast3", enforceAppCheck: true },
  async (request) => {
    try {
      const actor = await requireFieldActor(request);
      const note = await appendOwnerNoteCore(request.data, actor, ownerNoteDependencies);
      return { note };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      const code = error instanceof Error ? error.message : "owner_note_unknown";
      if (code === "owner_note_forbidden") throw new HttpsError("permission-denied", code);
      if (code === "owner_note_building_not_found") throw new HttpsError("not-found", code);
      if (code === "owner_note_id_conflict") throw new HttpsError("already-exists", code);
      if (code === "owner_note_rate_limited") throw new HttpsError("resource-exhausted", code);
      throw new HttpsError("invalid-argument", code);
    }
  },
);

export const archiveOwnerNote = onCall(
  { region: "asia-northeast3", enforceAppCheck: true },
  async (request) => {
    try {
      const actor = await requireFieldActor(request);
      return await archiveOwnerNoteCore(request.data, actor, ownerNoteDependencies);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      const code = error instanceof Error ? error.message : "owner_note_unknown";
      if (code.includes("forbidden")) throw new HttpsError("permission-denied", code);
      if (code === "owner_note_not_found") throw new HttpsError("not-found", code);
      if (code === "owner_note_rate_limited") throw new HttpsError("resource-exhausted", code);
      throw new HttpsError("invalid-argument", code);
    }
  },
);
```

Do not relax `enforceAppCheck`; add the production web App Check setup to the release gate in Task 10.

- [ ] **Step 5: Implement callable wrappers and latest-first subscription**

Reuse the predecessor's `firebase.client.ts` App Check initialization and `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`; do not initialize a second App Check instance. The Firebase Console web-app registration must use the exact production domains. For local callable acceptance, register the local App Check debug token in the same Firebase project before invoking the protected functions.

In `field-api.client.ts`, add these contracts and functions using the existing regional `functions` and `database` singletons:

```ts
import { onValue, orderByChild, limitToLast, query, ref } from "firebase/database";
import { httpsCallable } from "firebase/functions";
import type { OwnerNote } from "./types";

export interface AppendOwnerNoteInput {
  buildingId: string;
  localId: string;
  body: string;
  recordedAt: string;
}

const appendOwnerNoteCallable = httpsCallable<
  AppendOwnerNoteInput,
  { note: OwnerNote }
>(functions, "appendOwnerNote");

const archiveOwnerNoteCallable = httpsCallable<
  { buildingId: string; noteId: string },
  { archivedAt: string; archivedBy: string }
>(functions, "archiveOwnerNote");

export async function appendOwnerNote(input: AppendOwnerNoteInput): Promise<OwnerNote> {
  return (await appendOwnerNoteCallable(input)).data.note;
}

export async function archiveOwnerNote(input: {
  buildingId: string;
  noteId: string;
}): Promise<{ archivedAt: string; archivedBy: string }> {
  return (await archiveOwnerNoteCallable(input)).data;
}

export function sortOwnerNotes(value: unknown): OwnerNote[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value as Record<string, OwnerNote>)
    .filter((note) => note && !note.archivedAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function subscribeOwnerNotes(
  buildingId: string,
  listener: (notes: OwnerNote[]) => void,
  onError: (error: Error) => void,
  options: { limit?: number } = { limit: 50 },
): () => void {
  const ordered = query(
    ref(database, `fieldPlatform/ownerNotes/${buildingId}`),
    orderByChild("createdAt"),
  );
  const notesQuery = typeof options.limit === "number"
    ? query(ordered, limitToLast(options.limit))
    : ordered;
  return onValue(
    notesQuery,
    (snapshot) => listener(sortOwnerNotes(snapshot.val())),
    (error) => onError(error),
  );
}
```

- [ ] **Step 6: Run client/server tests and builds**

Run:

```bash
pnpm --dir functions exec vitest run test/owner-notes.test.ts test/save-field-registration.test.ts
pnpm --dir company-site exec vitest run tests/field/field-api.test.ts
pnpm --dir functions build
pnpm --dir company-site typecheck:field
```

Expected: all selected tests PASS, both packages type-check, conflicting retry data is rejected, and client payload tests contain no server-owned fields.

- [ ] **Step 7: Commit callables and client adapter**

```bash
git add functions/src/field/owner-notes.ts functions/src/index.ts functions/test/owner-notes.test.ts company-site/app/field/lib/field-api.client.ts company-site/tests/field/field-api.test.ts
git commit -m "feat(field): add owner note callables and subscription"
```

### Task 6: Lock owner notes behind assignment-aware, server-only rules

**Files:**
- Modify: `database.rules.json:23-110`
- Modify: `company-site/tests/field/database-rules.test.ts:66-210`

- [ ] **Step 1: Seed one note and write failing authorization tests**

Add this record to the existing `seed()` data:

```ts
ownerNotes: {
  "building-1": {
    "note_12345678": {
      id: "note_12345678",
      buildingId: "building-1",
      body: "서버 저장 메모",
      recordedAt: NOW,
      createdAt: NOW,
      createdBy: "staff-1",
      createdByName: "담당 직원",
    },
  },
},
```

Add these emulator assertions:

```ts
it("allows only assigned staff and admins to read owner notes", async () => {
  const assigned = environment.authenticatedContext("staff-1", claims("staff")).database();
  const unassigned = environment.authenticatedContext("staff-2", claims("staff")).database();
  const reviewer = environment.authenticatedContext("reviewer-1", claims("reviewer")).database();
  const admin = environment.authenticatedContext("admin-1", claims("admin")).database();
  await environment.withSecurityRulesDisabled(async (context) => {
    await set(ref(context.database(), "fieldPlatform/users/disabled-staff"), {
      enabled: false,
      role: "staff",
    });
    await set(ref(
      context.database(),
      "fieldPlatform/buildingAssignments/building-1/disabled-staff",
    ), true);
  });
  const disabled = environment.authenticatedContext("disabled-staff", claims("staff")).database();
  const path = "fieldPlatform/ownerNotes/building-1/note_12345678";

  await assertSucceeds(get(ref(assigned, path)));
  await assertSucceeds(get(ref(admin, path)));
  await assertFails(get(ref(unassigned, path)));
  await assertFails(get(ref(reviewer, path)));
  await assertFails(get(ref(disabled, path)));
});

it("rejects every direct client owner-note mutation", async () => {
  for (const [uid, role] of [
    ["staff-1", "staff"],
    ["reviewer-1", "reviewer"],
    ["admin-1", "admin"],
  ] as const) {
    const database = environment.authenticatedContext(uid, claims(role)).database();
    const path = "fieldPlatform/ownerNotes/building-1/note_12345678";
    await assertFails(update(ref(database, path), { body: "위조", createdAt: "2000-01-01" }));
    await assertFails(set(ref(database, path), null));
    await assertFails(set(ref(database, "fieldPlatform/ownerNotes/building-1/note_new1234"), {
      id: "note_new1234",
      buildingId: "building-1",
      body: "클라이언트 생성",
      recordedAt: NOW,
      createdAt: NOW,
      createdBy: uid,
      createdByName: "위조 이름",
    }));
  }
});
```

- [ ] **Step 2: Run the emulator suite and verify the read test fails**

Run from the repository root:

```bash
pnpm --dir company-site exec firebase emulators:exec --config ../firebase.json --only database --project demo-bring-field-platform "pnpm test:rules"
```

Expected: the new read test FAILS because `ownerNotes` has no read rule; direct mutations already fail under the root deny.

- [ ] **Step 3: Add the narrow owner-note rule block**

Add this sibling under `fieldPlatform` in `database.rules.json`:

```json
"ownerNotes": {
  "$buildingId": {
    ".read": "auth != null && auth.token.fieldPlatform === true && root.child('fieldPlatform/users').child(auth.uid).child('enabled').val() === true && (auth.token.fieldRole === 'admin' || (auth.token.fieldRole === 'staff' && root.child('fieldPlatform/buildingAssignments').child($buildingId).child(auth.uid).val() === true))",
    ".write": false,
    ".indexOn": ["createdAt"]
  }
}
```

Do not grant disabled users, reviewers, all-field users, or legacy email allowlists access. Add a disabled assigned-staff assertion alongside the role matrix so an old custom claim cannot read notes after the user record is turned off. Admin SDK callables bypass client rules and remain responsible for validation.

- [ ] **Step 4: Run the real emulator test again**

Run:

```bash
pnpm --dir company-site exec firebase emulators:exec --config ../firebase.json --only database --project demo-bring-field-platform "pnpm test:rules"
```

Expected: the database suite runs rather than skips and all tests PASS. Assigned staff/admin reads succeed; unassigned/reviewer reads and every direct write fail.

- [ ] **Step 5: Commit the rule boundary**

```bash
git add database.rules.json company-site/tests/field/database-rules.test.ts
git commit -m "security(field): protect owner notes with assignment rules"
```

### Task 7: Build the persistent, collapsible owner-note panel

**Files:**
- Create: `company-site/app/field/components/OwnerNotesPanel.tsx`
- Modify: `company-site/tests/field/components.test.tsx`
- Modify: `company-site/app/field/field.css`

- [ ] **Step 1: Write failing panel behavior tests**

Add a controlled harness to `components.test.tsx` and cover collapsed summary, local draft append, server append, and failure retention:

```tsx
function OwnerNotesHarness({
  buildingId,
  appendNote = async (input) => ({
    ...input,
    id: input.localId,
    createdAt: "2026-08-09T02:00:00.000Z",
    createdBy: "staff-1",
    createdByName: "담당 직원",
  }),
}: {
  buildingId?: string;
  appendNote?: (input: AppendOwnerNoteInput) => Promise<OwnerNote>;
}) {
  const [draftNotes, setDraftNotes] = useState<OwnerNoteDraft[]>([]);
  return (
    <OwnerNotesPanel
      buildingId={buildingId}
      draftId="draft-1"
      currentUser={{ uid: "staff-1", displayName: "담당 직원", role: "staff" }}
      draftNotes={draftNotes}
      onDraftNotesChange={setDraftNotes}
      createId={() => "note_12345678"}
      now={() => "2026-08-09T01:30:00.000Z"}
      initialExpanded={false}
      subscribeNotes={(_id, listener) => { listener([]); return () => undefined; }}
      appendNote={appendNote}
      archiveNote={vi.fn(async () => ({ archivedAt: "2026-08-09T02:10:00.000Z", archivedBy: "admin-1" }))}
    />
  );
}

it("keeps a new-building note in the controlled UID draft", () => {
  render(<OwnerNotesHarness />);
  expect(screen.getByRole("button", { name: "메모 추가" })).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
  fireEvent.change(screen.getByLabelText("새 건물주 전달사항"), { target: { value: "  주차선 확인  " } });
  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
  expect(screen.getByText("주차선 확인")).toBeInTheDocument();
  expect(screen.getByText("기기 저장됨 · 건물 등록 시 서버 전송")).toBeInTheDocument();
});

it("shows validation without appending a blank note", () => {
  render(<OwnerNotesHarness />);
  fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
  expect(screen.getByRole("alert")).toHaveTextContent("메모 내용을 입력해 주세요.");
});
```

Add these server-mode tests:

```tsx
it("appends an existing-building note with client-owned fields only", async () => {
  const appendNote = vi.fn(async (input: AppendOwnerNoteInput): Promise<OwnerNote> => ({
    ...input,
    id: input.localId,
    createdAt: "2026-08-09T02:00:00.000Z",
    createdBy: "staff-1",
    createdByName: "담당 직원",
  }));
  render(<OwnerNotesHarness buildingId="building-1" appendNote={appendNote} />);
  fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
  fireEvent.change(screen.getByLabelText("새 건물주 전달사항"), { target: { value: "수도 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
  await waitFor(() => expect(appendNote).toHaveBeenCalledWith({
    buildingId: "building-1",
    localId: "note_12345678",
    body: "수도 확인",
    recordedAt: "2026-08-09T01:30:00.000Z",
  }));
  expect(screen.getByText("서버 저장 완료")).toBeInTheDocument();
});

it("keeps a failed existing-building note available for the same-ID retry", async () => {
  const appendNote = vi.fn(async () => { throw new Error("offline"); });
  render(<OwnerNotesHarness buildingId="building-1" appendNote={appendNote} />);
  fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
  fireEvent.change(screen.getByLabelText("새 건물주 전달사항"), { target: { value: "보일러 확인" } });
  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
  expect(await screen.findByText("서버 저장 대기 · 다시 시도")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(appendNote).toHaveBeenCalledTimes(2));
  expect(appendNote.mock.calls[0][0].localId).toBe(appendNote.mock.calls[1][0].localId);
});
```

Add `waitFor` to the Testing Library import and import `OwnerNote`, `OwnerNoteDraft`, and `AppendOwnerNoteInput` as types.

- [ ] **Step 2: Run focused component tests and verify they fail**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/components.test.tsx -t "owner|건물주|controlled UID draft"
```

Expected: FAIL because `OwnerNotesPanel` does not exist.

- [ ] **Step 3: Implement the controlled panel contract**

Create `OwnerNotesPanel.tsx` with this public API:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  appendOwnerNote,
  archiveOwnerNote,
  subscribeOwnerNotes,
  type AppendOwnerNoteInput,
} from "../lib/field-api.client";
import type { FieldSession } from "../lib/auth.client";
import type { OwnerNote, OwnerNoteDraft } from "../lib/types";

export interface OwnerNotesPanelProps {
  buildingId?: string;
  draftId: string;
  currentUser: FieldSession;
  draftNotes: OwnerNoteDraft[];
  onDraftNotesChange(notes: OwnerNoteDraft[]): void;
  createId?: () => string;
  now?: () => string;
  initialExpanded?: boolean;
  appendNote?: (input: AppendOwnerNoteInput) => Promise<OwnerNote>;
  archiveNote?: (input: { buildingId: string; noteId: string }) => Promise<{
    archivedAt: string;
    archivedBy: string;
  }>;
  subscribeNotes?: typeof subscribeOwnerNotes;
}
```

Use defaults `crypto.randomUUID`, `new Date().toISOString`, `appendOwnerNote`, `archiveOwnerNote`, and `subscribeOwnerNotes`. Keep `expanded`, `showAll`, `body`, `serverNotes`, `status`, `error`, and `savingLocalId` as component state. Subscribe only when `buildingId` exists and always call the returned unsubscribe during effect cleanup. Subscribe with `{ limit: 50 }` normally and with `{}` after `showAll` becomes true.

Pass `(subscriptionError) => { setError("건물주 메모를 불러올 권한이 없거나 네트워크 연결이 끊겼습니다."); setStatus("메모 불러오기 실패"); }` as the subscription error callback. This creates the explicit unassigned/reviewer error state tested in Task 10.

- [ ] **Step 4: Implement trim/length checks, retry-safe append, and merged ordering**

Use this save path:

```ts
async function persistDraft(note: OwnerNoteDraft) {
  if (!buildingId) {
    onDraftNotesChange([note, ...draftNotes]);
    setStatus("기기 저장됨 · 건물 등록 시 서버 전송");
    return;
  }
  setSavingLocalId(note.localId);
  setStatus("서버 저장 중");
  try {
    await appendNote({
      buildingId,
      localId: note.localId,
      body: note.body,
      recordedAt: note.recordedAt,
    });
    onDraftNotesChange(draftNotes.filter((item) => item.localId !== note.localId));
    setStatus("서버 저장 완료");
  } catch {
    if (!draftNotes.some((item) => item.localId === note.localId)) {
      onDraftNotesChange([note, ...draftNotes]);
    }
    setStatus("서버 저장 대기 · 다시 시도");
  } finally {
    setSavingLocalId(null);
  }
}

async function saveNote() {
  const normalized = body.trim();
  if (!normalized) { setError("메모 내용을 입력해 주세요."); return; }
  if (normalized.length > 2000) { setError("메모는 2,000자 이내로 입력해 주세요."); return; }
  const note = {
    localId: createId(),
    draftId,
    body: normalized,
    recordedAt: now(),
  };
  setBody("");
  setError("");
  await persistDraft(note);
}
```

Merge server and draft items by `localId`, preferring the server item, and sort server entries by `createdAt` descending while local-only entries use `recordedAt`. A retry button calls `persistDraft` with the same `localId`. Never generate a replacement ID during retry.

Implement the merge and date helpers exactly once in this component:

```ts
type VisibleOwnerNote = OwnerNote | OwnerNoteDraft;

const mergedNotes = useMemo<VisibleOwnerNote[]>(() => {
  const serverIds = new Set(serverNotes.map((note) => note.id));
  return [
    ...serverNotes,
    ...draftNotes.filter((note) => !serverIds.has(note.localId)),
  ].sort((left, right) => {
    const leftTime = "createdAt" in left ? left.createdAt : left.recordedAt;
    const rightTime = "createdAt" in right ? right.createdAt : right.recordedAt;
    return rightTime.localeCompare(leftTime);
  });
}, [draftNotes, serverNotes]);

function isOfflineDelayed(note: VisibleOwnerNote): note is OwnerNote {
  return "createdAt" in note &&
    Math.abs(Date.parse(note.createdAt) - Date.parse(note.recordedAt)) > 300_000;
}

function formatKoreanDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
```

- [ ] **Step 5: Render accessible collapsed and expanded states**

The component root must be `<aside className="field-owner-notes" aria-labelledby="field-owner-notes-title">`. Its collapsed row contains `건물주 전달사항`, the newest note truncated to one visual line, status text in `aria-live="polite"`, and a button named `메모 추가` with `aria-expanded`. The expanded body contains:

```tsx
<label htmlFor="field-owner-note-body">새 건물주 전달사항</label>
<textarea
  id="field-owner-note-body"
  ref={composerRef}
  value={body}
  maxLength={2000}
  onChange={(event) => setBody(event.target.value)}
/>
<div className="field-owner-note-compose-actions">
  <span>{body.length} / 2,000</span>
  <button type="button" onClick={() => void saveNote()} disabled={Boolean(savingLocalId)}>
    메모 저장
  </button>
</div>
{error ? <p role="alert">{error}</p> : null}
<ol className="field-owner-note-list">
  {mergedNotes.map((note) => (
    <li key={"createdAt" in note ? note.id : note.localId}>
      <p>{note.body}</p>
      <small>{"createdAt" in note
        ? note.createdByName
        : `${currentUser.displayName} · 서버 저장 대기`}</small>
      {isOfflineDelayed(note) ? <em>오프라인에서 기록됨 · {formatKoreanDate(note.recordedAt)}</em> : null}
      {"localId" in note ? <button type="button" onClick={() => void persistDraft(note)}>다시 시도</button> : null}
      {currentUser.role === "admin" && buildingId && "createdAt" in note ? (
        <button type="button" onClick={() => void archiveNote({ buildingId, noteId: note.id })}>보관</button>
      ) : null}
    </li>
  ))}
</ol>
<button type="button" onClick={() => setShowAll((current) => !current)}>
  {showAll ? "최근 메모만 보기" : "전체 기록 보기"}
</button>
```

`isOfflineDelayed` returns true when `Math.abs(Date.parse(createdAt) - Date.parse(recordedAt)) > 300_000`. After expansion, focus the textarea with `requestAnimationFrame`; do not steal focus when a step changes.

- [ ] **Step 6: Add sticky/collapsible styling**

Add `.field-owner-notes` immediately before the progress styles in `field.css`:

```css
.field-owner-notes {
  position: sticky;
  z-index: 15;
  top: 70px;
  margin-top: 18px;
  border: 1px solid #d7e2ef;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.97);
  padding: 12px 14px;
  box-shadow: 0 10px 28px rgba(11, 35, 66, 0.1);
  backdrop-filter: blur(14px);
}

.field-owner-notes-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.field-owner-notes-latest {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-owner-notes-body,
.field-owner-note-list {
  display: grid;
  gap: 10px;
}

.field-owner-notes-body {
  max-height: min(58vh, 520px);
  margin-top: 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

@media (min-width: 960px) {
  .field-owner-notes { top: 78px; }
}
```

Style the textarea at 16px font size to avoid iOS zoom, use 44px minimum touch targets, allow `overflow-wrap:anywhere` for note text, and keep the list's newest item first.

- [ ] **Step 7: Run component/type checks and commit**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/components.test.tsx -t "owner|건물주|controlled UID draft"
pnpm --dir company-site typecheck:field
```

Expected: all panel tests PASS and TypeScript exits 0.

```bash
git add company-site/app/field/components/OwnerNotesPanel.tsx company-site/app/field/field.css company-site/tests/field/components.test.tsx
git commit -m "feat(field): add persistent owner notes panel"
```

### Task 8: Mount notes once across all wizard steps and submit them safely

**Files:**
- Modify: `company-site/app/field/lib/registration-draft.ts`
- Modify: `company-site/app/field/components/BuildingWizard.tsx`
- Modify: `company-site/app/field/FieldApp.tsx`
- Modify: `company-site/tests/field/registration-draft.test.ts`
- Modify: `company-site/tests/field/components.test.tsx`

- [ ] **Step 1: Write failing transport and persistent-mount tests**

Extend `registration-draft.test.ts`:

```ts
it("maps local owner notes to the callable without client-owned server stamps", () => {
  const draft = createRegistrationDraft(validInitial, idFactory);
  draft.ownerNoteDrafts = [{
    localId: "note_12345678",
    draftId: draft.draftId,
    body: "  주차 위치 확인  ",
    recordedAt: "2026-08-09T01:30:00.000Z",
  }];
  const input = toSaveFieldRegistrationInput(draft);
  expect(input.ownerNoteDrafts).toEqual([{
    localId: "note_12345678",
    body: "주차 위치 확인",
    recordedAt: "2026-08-09T01:30:00.000Z",
  }]);
  expect(JSON.stringify(input.ownerNoteDrafts)).not.toMatch(/createdAt|createdBy|createdByName/);
});
```

Add this wizard test after creating a valid fixture that starts on step 2:

```tsx
it("keeps the same owner-note panel mounted while all wizard steps change", () => {
  render(<BuildingWizard session={staffSession} initialStep={2} initialDraft={validInitialDraft} />);
  fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
  fireEvent.change(screen.getByLabelText("새 건물주 전달사항"), { target: { value: "도배 색상 확인" } });
  const panel = screen.getByLabelText("건물주 전달사항");
  fireEvent.click(screen.getByRole("button", { name: "다음 단계" }));
  expect(screen.getByLabelText("건물주 전달사항")).toBe(panel);
  expect(screen.getByLabelText("새 건물주 전달사항")).toHaveValue("도배 색상 확인");
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/registration-draft.test.ts tests/field/components.test.tsx -t "owner notes|owner-note panel"
```

Expected: FAIL because transport mapping omits notes and the panel is not mounted by `BuildingWizard`.

- [ ] **Step 3: Extend the registration transport mapper**

In `toSaveFieldRegistrationInput`, add:

```ts
ownerNoteDrafts: draft.ownerNoteDrafts.map(({ localId, body, recordedAt }) => ({
  localId,
  body: body.trim(),
  recordedAt,
})),
```

The mapper must reject a note whose `draftId !== draft.draftId`; it must not silently send a note copied from another draft.

- [ ] **Step 4: Mount one controlled panel outside every step conditional**

In `BuildingWizard.tsx`, place this once between `.field-wizard-header` and `.field-wizard-progress`:

```tsx
<OwnerNotesPanel
  buildingId={savedBuildingId}
  draftId={draft.draftId}
  currentUser={session}
  draftNotes={draft.ownerNoteDrafts}
  onDraftNotesChange={(ownerNoteDrafts) => updateDraft((current) => ({
    ...current,
    ownerNoteDrafts,
  }))}
/>
```

Do not render the panel inside any `step === n` branch. Add `savedBuildingId` state and change the completion contract to await the predecessor response:

```ts
const result = await onComplete(toSaveFieldRegistrationInput(draft));
setSavedBuildingId(result.buildingId);
removeWizardDraft(resolvedStorage, session.uid, draft.draftId);
setSaveStatus("서버 저장 완료");
```

Use a `completedRef` guard so the autosave effect does not immediately recreate the removed envelope. If registration fails, retain every draft note and show `서버 저장 실패 · 로컬 초안 유지`; never clear first.

- [ ] **Step 5: Consume the session inside the authenticated workspace**

Split the current `FieldApp` content into an inner component and consume the provider created in Task 1:

```tsx
function FieldWorkspace() {
  const session = useFieldSession();
  const [active, setActive] = useState<FieldDestination>("home");
  return (
    <AppShell active={active} onNavigate={setActive}>
      {active === "home" ? (
        <Dashboard onNavigate={setActive} />
      ) : active === "map" ? (
        <FieldMapPanel />
      ) : active === "buildings" ? (
        <BuildingWizard session={session} onComplete={saveFieldRegistration} />
      ) : (
        <DestinationScreen destination={active} />
      )}
    </AppShell>
  );
}

export default function FieldApp() {
  return <AuthGate><FieldWorkspace /></AuthGate>;
}
```

Import and keep the predecessor's `saveFieldRegistration` wiring; do not replace it with local-only completion.
Rename the current local terminal-screen component to `DestinationScreen` without changing its existing capture/package copy so the symbol matches its continuing navigation role.

- [ ] **Step 6: Add an account-switch draft integration test**

Add this value-level integration test:

```tsx
it("restores only the active UID's pending owner notes after account switches", () => {
  const sessionA = { uid: "staff-a", displayName: "직원 A", role: "staff" as const };
  const sessionB = { uid: "staff-b", displayName: "직원 B", role: "staff" as const };
  const view = render(
    <FieldSessionProvider key={sessionA.uid} session={sessionA}>
      <BuildingWizard session={sessionA} draftId="switch-draft" />
    </FieldSessionProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
  fireEvent.change(screen.getByLabelText("새 건물주 전달사항"), { target: { value: "A 전용 메모" } });
  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
  expect(screen.getByText("A 전용 메모")).toBeInTheDocument();

  view.rerender(
    <FieldSessionProvider key={sessionB.uid} session={sessionB}>
      <BuildingWizard session={sessionB} draftId="switch-draft" />
    </FieldSessionProvider>,
  );
  expect(screen.queryByText("A 전용 메모")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "메모 추가" }));
  fireEvent.change(screen.getByLabelText("새 건물주 전달사항"), { target: { value: "B 전용 메모" } });
  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));

  view.rerender(
    <FieldSessionProvider key={sessionA.uid} session={sessionA}>
      <BuildingWizard session={sessionA} draftId="switch-draft" />
    </FieldSessionProvider>,
  );
  expect(screen.getByText("A 전용 메모")).toBeInTheDocument();
  expect(screen.queryByText("B 전용 메모")).not.toBeInTheDocument();
});
```

Import `FieldSessionProvider`. This verifies rendered values as well as scoped storage behavior.

- [ ] **Step 7: Run tests, typecheck, and commit**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/registration-draft.test.ts tests/field/components.test.tsx tests/field/field-api.test.ts
pnpm --dir company-site typecheck:field
```

Expected: transport, persistent mount, registration success/failure, and account-switch tests PASS.

```bash
git add company-site/app/field/lib/registration-draft.ts company-site/app/field/components/BuildingWizard.tsx company-site/app/field/FieldApp.tsx company-site/tests/field/registration-draft.test.ts company-site/tests/field/components.test.tsx
git commit -m "feat(field): connect owner notes to registration"
```

### Task 9: Replace the moving footer with a keyboard-safe fixed action dock

**Files:**
- Create: `company-site/app/field/lib/visual-viewport.ts`
- Create: `company-site/tests/field/visual-viewport.test.ts`
- Modify: `company-site/app/field/components/BuildingWizard.tsx:403-411`
- Modify: `company-site/app/field/field.css:1424-1508`
- Modify: `company-site/tests/field/components.test.tsx`

- [ ] **Step 1: Write failing viewport and stable-DOM tests**

Create `visual-viewport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { keyboardInset } from "../../app/field/lib/visual-viewport";

describe("keyboardInset", () => {
  it("returns zero for browser chrome changes below the keyboard threshold", () => {
    expect(keyboardInset(800, { height: 740, offsetTop: 0 })).toBe(0);
  });
  it("returns the occluded layout area for an open software keyboard", () => {
    expect(keyboardInset(800, { height: 430, offsetTop: 20 })).toBe(350);
  });
  it("never returns a negative inset", () => {
    expect(keyboardInset(700, { height: 720, offsetTop: 0 })).toBe(0);
  });
});
```

Add these component assertions:

```tsx
it("keeps two action slots and a disabled back button on the first step", () => {
  render(<BuildingWizard session={staffSession} draftId="dock-first-step" />);
  const dock = screen.getByRole("group", { name: "등록 단계 이동" });
  expect(within(dock).getAllByRole("button")).toHaveLength(2);
  expect(within(dock).getByRole("button", { name: "이전" })).toBeDisabled();
  expect(within(dock).getByRole("button", { name: "다음 단계" })).toBeEnabled();
});

it("keeps the same action dock node when the step content changes", () => {
  render(<BuildingWizard session={staffSession} draftId="dock-stable" initialStep={2} />);
  const dock = screen.getByRole("group", { name: "등록 단계 이동" });
  fireEvent.click(within(dock).getByRole("button", { name: "다음 단계" }));
  expect(screen.getByRole("group", { name: "등록 단계 이동" })).toBe(dock);
  expect(screen.getByText("옵션·비품")).toBeInTheDocument();
});
```

Add `within` to the Testing Library import.

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/visual-viewport.test.ts tests/field/components.test.tsx -t "keyboardInset|등록 단계 이동"
```

Expected: FAIL because the viewport helper/group do not exist and the current dock has a third `입력 확인` button.

- [ ] **Step 3: Implement and bind the Visual Viewport adapter**

Create `visual-viewport.ts`:

```ts
export interface VisualViewportSize {
  height: number;
  offsetTop: number;
}

export function keyboardInset(layoutHeight: number, viewport: VisualViewportSize): number {
  const occluded = Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop));
  return occluded >= 120 ? occluded : 0;
}

export function bindVisualViewport(
  root: HTMLElement,
  target: Window,
): () => void {
  const viewport = target.visualViewport;
  if (!viewport) return () => undefined;
  const update = () => {
    const inset = keyboardInset(target.innerHeight, viewport);
    root.style.setProperty("--field-keyboard-inset", `${inset}px`);
    root.dataset.fieldKeyboardOpen = inset > 0 ? "true" : "false";
  };
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  update();
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    root.style.removeProperty("--field-keyboard-inset");
    delete root.dataset.fieldKeyboardOpen;
  };
}
```

Call `bindVisualViewport(document.documentElement, window)` in one `BuildingWizard` effect and return its cleanup.

- [ ] **Step 4: Render exactly two stable action slots**

Replace the footer with:

```tsx
<footer className="field-wizard-actions" role="group" aria-label="등록 단계 이동">
  <button
    type="button"
    className="field-wizard-back"
    onClick={() => setStep((current) => Math.max(current - 1, 0))}
    disabled={step === 0}
  >
    이전
  </button>
  {step < STEPS.length - 1 ? (
    <button type="button" className="field-wizard-next" onClick={nextStep}>다음 단계</button>
  ) : (
    <button type="button" className="field-wizard-next" onClick={complete} disabled={submitting}>
      {submitting ? "저장 중" : "등록 내용 저장"}
    </button>
  )}
</footer>
```

Remove `입력 확인`; `nextStep` already invokes `validateCurrentStep`. Keep the primary button enabled so an invalid first step can show field errors; validation prevents advancement. Keep `주소 중복 확인` beside the address field.

Update the predecessor address test accordingly: before address verification, assert `다음 단계` is enabled, click it, and assert the required-field or `주소 확인으로 지도 위치를 설정해 주세요` message while the step remains 1. After a successful address check, clicking the same button must advance to `임대조건`. The duplicate-address test must click the enabled primary button and assert it remains on `건물`.

- [ ] **Step 5: Replace sticky CSS with viewport-fixed, width-constrained CSS**

Replace the current `.field-wizard-actions` block and desktop override with:

```css
.field-platform {
  --field-sidebar-width: 0px;
  --field-mobile-nav-height: 70px;
  --field-keyboard-inset: 0px;
}

.field-wizard {
  padding-bottom: calc(92px + var(--field-mobile-nav-height) + env(safe-area-inset-bottom));
}

.field-wizard-actions {
  position: fixed;
  z-index: 25;
  right: max(12px, env(safe-area-inset-right));
  bottom: calc(var(--field-mobile-nav-height) + env(safe-area-inset-bottom) + 8px);
  left: max(12px, env(safe-area-inset-left));
  display: grid;
  grid-template-columns: minmax(92px, 0.7fr) minmax(150px, 1.3fr);
  gap: 8px;
  width: min(calc(100% - 24px), 980px);
  margin: 0 auto;
  border: 1px solid rgba(211, 220, 231, 0.9);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.96);
  padding: 10px;
  box-shadow: 0 12px 35px rgba(11, 35, 66, 0.16);
  backdrop-filter: blur(14px);
}

html[data-field-keyboard-open="true"] .field-mobile-nav {
  visibility: hidden;
  pointer-events: none;
}

html[data-field-keyboard-open="true"] .field-wizard-actions {
  bottom: calc(var(--field-keyboard-inset) + 8px);
}

@media (min-width: 960px) {
  .field-platform { --field-sidebar-width: 238px; }
  .field-wizard { padding-bottom: 96px; }
  .field-wizard-actions {
    right: 24px;
    bottom: 18px;
    left: calc(var(--field-sidebar-width) + 24px);
    width: min(calc(100% - var(--field-sidebar-width) - 48px), 980px);
  }
}

@media (min-width: 1260px) {
  .field-platform { --field-sidebar-width: 258px; }
}
```

Also set `.field-main { scroll-padding-bottom: 190px; }` on mobile and `scroll-padding-bottom: 110px` on desktop so `scrollIntoView` and browser focus scrolling do not hide the final input behind the dock.

- [ ] **Step 6: Run viewport/component checks and commit**

Run:

```bash
pnpm --dir company-site exec vitest run tests/field/visual-viewport.test.ts tests/field/components.test.tsx
pnpm --dir company-site typecheck:field
```

Expected: viewport math and all wizard tests PASS; the first-step back button retains its slot and the dock node survives step changes.

```bash
git add company-site/app/field/lib/visual-viewport.ts company-site/app/field/components/BuildingWizard.tsx company-site/app/field/field.css company-site/tests/field/visual-viewport.test.ts company-site/tests/field/components.test.tsx
git commit -m "fix(field): pin wizard actions above mobile keyboard"
```

### Task 10: Run the full security, regression, and mobile acceptance gate

**Files:**
- Verify only: all files changed in Tasks 1–9

- [ ] **Step 1: Run all deterministic frontend and server checks**

Run from the repository root:

```bash
pnpm --dir company-site test:field:run
pnpm --dir company-site typecheck:field
pnpm --dir functions test
pnpm --dir functions build
git diff --check
```

Expected: every Vitest suite PASS, both TypeScript commands exit 0, and `git diff --check` prints no whitespace errors. The field suite must include registration-draft migration, session switching, owner-note panel, callable mapping, and viewport tests.

- [ ] **Step 2: Run rules under the real Database Emulator**

Run:

```bash
pnpm --dir company-site exec firebase emulators:exec --config ../firebase.json --only database --project demo-bring-field-platform "pnpm test:rules"
```

Expected: tests run rather than skip and all PASS. Confirm output includes the owner-note read/write cases; assigned staff/admin reads succeed, reviewer/unassigned reads fail, and every client mutation fails.

- [ ] **Step 3: Verify App Check configuration, then build deployable artifacts**

In the same deployment shell that will run the site build, verify the public key exists without printing its value:

```powershell
if ([string]::IsNullOrWhiteSpace($env:NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY)) { throw 'App Check site key is not configured' }
Write-Output 'App Check site key configured'
```

Expected: `App Check site key configured`. Then run:

```bash
pnpm --dir company-site build
pnpm --dir company-site test
pnpm --dir functions build
```

Expected: Vinext build embeds the configured public App Check key and exits 0 with `/field`, rendered-HTML tests PASS, and Functions emits JavaScript under `functions/lib` without TypeScript errors.

- [ ] **Step 4: Verify protected callable App Check behavior**

In Firebase Console, confirm the web app has the production hosting/custom domains registered and the local debug token is registered only for development. A request with a valid authenticated staff token but no App Check token must fail; the same request with the registered token must reach assignment validation.

- [ ] **Step 5: Perform responsive browser acceptance at 320×568, 390×844, and desktop**

Start the app:

```bash
pnpm --dir company-site dev
```

Open `/field`, sign in with an approved test account, and verify this exact sequence at each viewport:

1. Open `건물`; confirm no other account's building name or memo flashes before the current UID draft appears.
2. On steps 1, 3, and 7, confirm `건물주 전달사항` stays immediately below the app header, collapses to one latest line, expands, and retains unsaved composer text after step changes.
3. Save a local note containing leading/trailing spaces; confirm the trimmed body appears, author/time labels are visible, and a blank/2,001-character body is rejected.
4. Confirm `이전` is disabled but visible on step 1 and that the two dock buttons occupy the same coordinates after moving through all seven steps.
5. Focus the last textarea on each long step; confirm the software keyboard leaves both the focused field and fixed primary button usable, hides the mobile navigation while open, and restores it after blur.
6. Confirm the page has no horizontal scrollbar at 320px and the dock remains within the main work area at desktop/sidebar widths.
7. Complete registration; confirm initial notes change from local pending to server history and a second identical save does not duplicate them.
8. Add a post-registration note; confirm `서버 저장 중` changes to `서버 저장 완료`. Disable the network, add another note, confirm `서버 저장 대기 · 다시 시도`, restore the network, retry, and confirm the same item is saved once.
9. Sign out and sign in as a different approved account on the same browser; confirm the previous UID's draft and pending memo are absent. Switch back and confirm the original draft returns.

Expected: all nine checks pass at all three widths. On iPhone Safari/PWA and Android Chrome/PWA, repeat check 5 using the real software keyboard because desktop emulation cannot prove Visual Viewport behavior.

- [ ] **Step 6: Verify role behavior with seeded test users**

Using one assigned staff, one unassigned staff, one reviewer, and one administrator:

- Assigned staff sees history and appends.
- Unassigned staff receives the panel's permission error and no note data.
- Reviewer receives no note data and cannot append.
- Administrator sees history, appends, and archives; archived notes disappear from the active list without physical deletion.
- The managed-building map payload, listing payload, advertising package, and Drive-facing description contain none of the test memo text, author name, or archive metadata.

Expected: every role matches the rule/callable policy and the sensitive test phrase is absent from serialized map/advertising outputs.

- [ ] **Step 7: Record the verified commit boundary**

Run:

```bash
git status --short
git log -10 --oneline
```

Expected: no unexpected generated files are tracked; the log shows separate commits for session propagation, UID draft persistence, note policy, atomic registration notes, callable/subscription, rules, panel UI, wizard wiring, and fixed dock. Do not create a verification-only commit when the worktree is already clean.

## Execution handoff

Execute with `superpowers:subagent-driven-development` so each task receives a fresh implementer and two-stage review. Keep this order: managed-map predecessor → Tasks 1–6 security/data boundary → Tasks 7–9 UI → Task 10 full acceptance. Do not start the capture/upload plan until Task 10's deterministic tests and emulator gate are green; that plan depends on `FieldSessionProvider` and `useFieldSession()` from Task 1.
