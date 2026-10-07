# BRING CRM Embedded FIELD SSO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open BRING FIELD inside the BRING CRM desktop window and authenticate it automatically from the existing CRM employee session without weakening standalone FIELD security.

**Architecture:** The FIELD Functions project issues a 60-second, single-use handoff code after verifying a `bring-fm-hj` CRM ID token and the existing FIELD email allowlist. The embedded FIELD web app consumes the code, signs in with a `bring-fm` custom token, and removes the code from the URL. Electron hosts the trusted FIELD origin in a sandboxed `WebContentsView`; CRM tokens remain inside the main-process `FirebaseRemoteClient`.

**Tech Stack:** Electron 39, Node.js 22, Firebase Admin/Auth/Realtime Database/Functions v2, React 19, TypeScript 5.9, Vitest, Node test runner, Firebase Hosting, electron-builder.

---

## File map

- `functions/src/auth/desktop-field-handoff.ts`: pure validation, issue, consume, expiry, and replay protection.
- `functions/test/desktop-field-handoff.test.ts`: deterministic server core tests.
- `functions/src/index.ts`: Firebase Admin adapters and the two callable entry points.
- `functions/test/index-entrypoints.test.ts`: exported callable and region registration checks.
- `database.rules.json`: deny client access to handoff and handoff-rate-limit records.
- `company-site/app/field/lib/desktop-handoff.client.ts`: query parsing, callable exchange, custom-token sign-in, URL cleanup.
- `company-site/app/field/components/DesktopFieldBootstrap.tsx`: embedded connection state and logout bridge.
- `company-site/app/field/FieldApp.tsx`: bootstrap selection before the existing `AuthGate`.
- `company-site/app/field/components/AppShell.tsx`: hide FIELD-only logout/Drive controls in CRM-embedded mode.
- `company-site/tests/field/desktop-handoff.test.ts`: client exchange and URL hygiene.
- `company-site/tests/field/desktop-bootstrap.test.tsx`: embedded loading/error/session UI.
- `desktop-crm/src/remote.js`: fresh CRM token access and fixed callable request; token never reaches renderer.
- `desktop-crm/src/main.js`: secure `WebContentsView` lifecycle, bounds, navigation policy, and teardown.
- `desktop-crm/src/preload.js`: renderer-safe show/hide commands with no URL or token parameters.
- `desktop-crm/src/app.js`: FIELD menu selection and return to CRM views.
- `desktop-crm/test/field-platform-entry.test.js`: IPC and no-external-browser regression.
- `desktop-crm/test/field-web-contents.test.js`: origin allowlist, bounds, logout, and popup policy.

### Task 1: Put the released desktop source under version control

**Files:**
- Create: `desktop-crm/package.json`
- Create: `desktop-crm/src/*.js`
- Create: `desktop-crm/src/index.html`
- Create: `desktop-crm/test/field-platform-entry.test.js`
- Create: `desktop-crm/README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Copy only the reviewed v1.5.0 sources, excluding generated output**

Run from the feature worktree:

```powershell
Copy-Item -Recurse -LiteralPath 'C:\Users\user\AppData\Local\Temp\bring-crm-desktop-field-20260813\desktop-crm' -Destination '.\desktop-crm'
Remove-Item -Recurse -Force -LiteralPath '.\desktop-crm\node_modules', '.\desktop-crm\dist' -ErrorAction SilentlyContinue
```

Expected: `desktop-crm/src/main.js` and `desktop-crm/test/field-platform-entry.test.js` exist; `desktop-crm/node_modules` and `desktop-crm/dist` do not.

- [ ] **Step 2: Pin generated directories in the repository ignore file**

Add exactly:

```gitignore
desktop-crm/node_modules/
desktop-crm/dist/
```

- [ ] **Step 3: Verify the imported source reproduces the released baseline**

Run:

```powershell
Set-Location desktop-crm
npm install
npm test
npm run smoke
```

Expected: Node tests pass and the smoke command exits `0` without reading the employee production cache.

- [ ] **Step 4: Commit the baseline separately**

```powershell
git add .gitignore desktop-crm/package.json desktop-crm/package-lock.json desktop-crm/README.md desktop-crm/src desktop-crm/test
git commit -m "chore: track BRING CRM desktop source"
```

### Task 2: Build the one-time handoff core with replay protection

**Files:**
- Create: `functions/src/auth/desktop-field-handoff.ts`
- Create: `functions/test/desktop-field-handoff.test.ts`

- [ ] **Step 1: Write failing tests for issue, expiry, and single consumption**

The tests must exercise this public contract:

```ts
const issued = await issueDesktopFieldHandoffCore({
  crmUid: "crm-uid",
  email: "bringengineering1008@gmail.com",
  emailVerified: true,
  displayName: "서창환",
}, dependencies);

expect(issued.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
expect(issued.expiresAt).toBe(1_060_000);
expect(dependencies.savedKey).toBe(sha256Base64Url(issued.code));
expect(JSON.stringify(dependencies.savedRecord)).not.toContain(issued.code);

const first = await consumeDesktopFieldHandoffCore({ code: issued.code }, dependencies);
await expect(consumeDesktopFieldHandoffCore({ code: issued.code }, dependencies))
  .rejects.toThrow("desktop_handoff_used");
```

Add separate cases for unverified email, inactive allowlist, invalid role, malformed code, expired code, and two concurrent consumers where exactly one succeeds.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --dir functions exec vitest run test/desktop-field-handoff.test.ts --reporter=verbose
```

Expected: FAIL because `desktop-field-handoff.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure core**

Create these stable types and exports:

```ts
export type DesktopHandoffRole = "admin" | "staff" | "reviewer";

export interface DesktopHandoffRecord {
  crmUid: string;
  fieldUid: string;
  emailHash: string;
  role: DesktopHandoffRole;
  displayName: string;
  issuedAt: number;
  expiresAt: number;
  usedAt: null;
}

export interface DesktopHandoffDependencies {
  now(): number;
  randomBytes(size: number): Uint8Array;
  getAllowedEmail(emailHash: string): Promise<{ active: boolean; role: DesktopHandoffRole } | null>;
  resolveFieldUser(input: { email: string; displayName: string; role: DesktopHandoffRole }): Promise<string>;
  save(codeHash: string, record: DesktopHandoffRecord): Promise<void>;
  consume(codeHash: string, now: number): Promise<DesktopHandoffRecord | null>;
  createCustomToken(uid: string, claims: { fieldPlatform: true; fieldRole: DesktopHandoffRole }): Promise<string>;
}

export function sha256Base64Url(value: string): string;
export async function issueDesktopFieldHandoffCore(identity: DesktopCrmIdentity, deps: DesktopHandoffDependencies): Promise<{ code: string; expiresAt: number }>;
export async function consumeDesktopFieldHandoffCore(input: { code: string }, deps: DesktopHandoffDependencies): Promise<{ customToken: string }>;
```

Generate 32 random bytes, encode base64url, store only `sha256Base64Url(code)`, set `expiresAt = now + 60_000`, and require `consume()` to perform the atomic unused-to-used transition.

- [ ] **Step 4: Run focused tests and Functions typecheck**

```powershell
pnpm --dir functions exec vitest run test/desktop-field-handoff.test.ts --reporter=verbose
pnpm --dir functions build
```

Expected: all new cases pass and TypeScript exits `0`.

- [ ] **Step 5: Commit the pure server core**

```powershell
git add functions/src/auth/desktop-field-handoff.ts functions/test/desktop-field-handoff.test.ts
git commit -m "feat: add single-use FIELD desktop handoff core"
```

### Task 3: Expose secure Firebase callable adapters

**Files:**
- Modify: `functions/src/index.ts`
- Modify: `functions/test/index-entrypoints.test.ts`
- Modify: `database.rules.json`
- Modify: `company-site/tests/field/database-rules.test.ts`

- [ ] **Step 1: Write failing entrypoint and rules assertions**

Add assertions that `index.ts` exports both callables in `asia-northeast3`, initializes a named verifier for project `bring-fm-hj`, and that the database rules contain server-only nodes:

```ts
expect(source).toContain("export const createDesktopFieldHandoff");
expect(source).toContain("export const exchangeDesktopFieldHandoff");
expect(source).toContain('projectId: "bring-fm-hj"');
expect(rules.fieldPlatform.desktopHandoffs[".read"]).toBe(false);
expect(rules.fieldPlatform.desktopHandoffs[".write"]).toBe(false);
expect(rules.fieldPlatform.desktopHandoffs[".indexOn"]).toContain("expiresAt");
expect(rules.fieldPlatform.desktopHandoffRateLimits).toEqual({ ".read": false, ".write": false });
```

- [ ] **Step 2: Run the tests and verify RED**

```powershell
pnpm --dir functions exec vitest run test/index-entrypoints.test.ts --reporter=verbose
pnpm --dir company-site exec vitest run tests/field/database-rules.test.ts --reporter=verbose
```

Expected: FAIL because the exports and server-owned rules do not exist.

- [ ] **Step 3: Add the Firebase Admin adapters**

Use a named Admin app only for CRM token verification:

```ts
const crmVerifierApp = getApps().find(app => app.name === "crm-auth-verifier")
  ?? initializeApp({ projectId: "bring-fm-hj" }, "crm-auth-verifier");
const crmVerifierAuth = getAuth(crmVerifierApp);

export const createDesktopFieldHandoff = onCall(
  { region: "asia-northeast3", cors: ["https://bring-fm.web.app", "https://bring-fm.firebaseapp.com"] },
  async request => {
    const crmIdToken = requireBoundedString(request.data?.crmIdToken, 12_000);
    const decoded = await crmVerifierAuth.verifyIdToken(crmIdToken, true);
    return issueDesktopFieldHandoffCore({
      crmUid: decoded.uid,
      email: decoded.email ?? "",
      emailVerified: decoded.email_verified === true,
      displayName: typeof decoded.name === "string" ? decoded.name : "",
    }, desktopHandoffDependencies(request.rawRequest.ip));
  },
);

export const exchangeDesktopFieldHandoff = onCall(
  { region: "asia-northeast3", cors: ["https://bring-fm.web.app", "https://bring-fm.firebaseapp.com"] },
  request => consumeDesktopFieldHandoffCore(
    { code: requireBoundedString(request.data?.code, 64) },
    desktopHandoffDependencies(request.rawRequest.ip),
  ),
);

export const cleanupDesktopFieldHandoffs = onSchedule(
  { region: "asia-northeast3", schedule: "every 60 minutes", timeZone: "Asia/Seoul" },
  async () => cleanupExpiredDesktopHandoffs(adminDatabase, Date.now(), 500),
);
```

The adapter must:

- query `fieldPlatform/allowedEmails/{sha256(normalizedEmail)}`;
- resolve the existing FIELD Auth user with `getUserByEmail`, creating an email-verified user only when absent;
- set `{ fieldPlatform: true, fieldRole }` claims and `fieldPlatform/users/{uid}` before issuing the handoff;
- transact `fieldPlatform/desktopHandoffs/{codeHash}` so only an unexpired `usedAt: null` record can be consumed;
- apply the existing transaction rate limiter to an SHA-256 key derived from IP and CRM UID/code hash;
- map all failures to fixed `HttpsError` messages without raw tokens, codes, email addresses, or Firebase error payloads.
- query expired records by `expiresAt`, remove at most 500 per scheduled run, and leave newer records untouched.

- [ ] **Step 4: Make handoff storage server-only**

Under `fieldPlatform`, add:

```json
"desktopHandoffs": {
  ".read": false,
  ".write": false,
  ".indexOn": ["expiresAt"]
},
"desktopHandoffRateLimits": {
  ".read": false,
  ".write": false
}
```

- [ ] **Step 5: Run server, rules, and build verification**

```powershell
pnpm --dir functions exec vitest run test/desktop-field-handoff.test.ts test/index-entrypoints.test.ts --reporter=verbose
pnpm --dir functions build
pnpm --dir company-site exec vitest run tests/field/database-rules.test.ts --reporter=verbose
```

Expected: focused suites pass, Functions build exits `0`, and the static rules assertions pass.

- [ ] **Step 6: Commit the callable boundary**

```powershell
git add functions/src/index.ts functions/test/index-entrypoints.test.ts database.rules.json company-site/tests/field/database-rules.test.ts
git commit -m "feat: expose secure CRM to FIELD handoff"
```

### Task 4: Consume the handoff in FIELD before showing Google login

**Files:**
- Create: `company-site/app/field/lib/desktop-handoff.client.ts`
- Create: `company-site/tests/field/desktop-handoff.test.ts`
- Modify: `company-site/app/field/lib/auth.client.ts`

- [ ] **Step 1: Write failing client tests**

Cover valid parsing, malformed or duplicated query parameters, callable exchange, custom-token sign-in, URL removal, and error normalization:

```ts
const result = await consumeDesktopHandoffFromUrl(
  new URL("https://bring-fm.web.app/field?embedded=crm&desktop_handoff=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
  {
    exchange: async code => ({ customToken: code.startsWith("AAAA") ? "firebase-custom" : "" }),
    signIn: async token => { signedInWith = token; },
    replaceUrl: url => { replacedWith = url; },
  },
);

expect(result).toEqual({ mode: "crm", consumed: true });
expect(signedInWith).toBe("firebase-custom");
expect(replacedWith).toBe("/field?embedded=crm");
```

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
pnpm --dir company-site exec vitest run tests/field/desktop-handoff.test.ts --reporter=verbose
```

Expected: FAIL because the client module is missing.

- [ ] **Step 3: Implement the strict client boundary**

Export:

```ts
export type DesktopHandoffState =
  | { mode: "standalone"; consumed: false }
  | { mode: "crm"; consumed: boolean; error?: "expired" | "denied" | "unavailable" };

export async function consumeDesktopHandoffFromUrl(
  url: URL,
  dependencies: DesktopHandoffClientDependencies,
): Promise<DesktopHandoffState>;
```

The production dependencies use `httpsCallable(functions, "exchangeDesktopFieldHandoff")`, `signInWithCustomToken(auth, customToken)`, and `history.replaceState`. Accept one `desktop_handoff` value matching `/^[A-Za-z0-9_-]{43}$/`; never log or store the code/custom token.

- [ ] **Step 4: Add a logout bridge without clearing the upload queue**

In `auth.client.ts`, export:

```ts
export function observeDesktopLogout(logout = logoutFieldUser): () => void {
  const listener = () => { void logout(); };
  window.addEventListener("bring-crm-logout", listener);
  return () => window.removeEventListener("bring-crm-logout", listener);
}
```

This signs Firebase Auth out but deliberately preserves the IndexedDB media queue, which remains keyed by UID and resumes after the same employee reconnects.

- [ ] **Step 5: Verify the focused suite and typecheck**

```powershell
pnpm --dir company-site exec vitest run tests/field/desktop-handoff.test.ts tests/field/auth.test.ts --reporter=verbose
pnpm --dir company-site typecheck:field
```

Expected: all tests pass and TypeScript exits `0`.

- [ ] **Step 6: Commit the FIELD client exchange**

```powershell
git add company-site/app/field/lib/desktop-handoff.client.ts company-site/app/field/lib/auth.client.ts company-site/tests/field/desktop-handoff.test.ts company-site/tests/field/auth.test.ts
git commit -m "feat: accept CRM desktop FIELD sessions"
```

### Task 5: Add the embedded bootstrap UI and single logout surface

**Files:**
- Create: `company-site/app/field/components/DesktopFieldBootstrap.tsx`
- Create: `company-site/tests/field/desktop-bootstrap.test.tsx`
- Modify: `company-site/app/field/FieldApp.tsx`
- Modify: `company-site/app/field/components/AppShell.tsx`
- Modify: `company-site/app/field/field.css`

- [ ] **Step 1: Write failing component tests**

Assert these visible states:

```tsx
render(<DesktopFieldBootstrap exchange={pendingExchange}><FieldWorkspace /></DesktopFieldBootstrap>);
expect(screen.getByRole("status")).toHaveTextContent("CRM 계정 연결 중");

render(<DesktopFieldBootstrap exchange={expiredExchange}><FieldWorkspace /></DesktopFieldBootstrap>);
expect(screen.getByRole("alert")).toHaveTextContent("연결 시간이 만료되었습니다");
expect(screen.getByRole("button", { name: "다시 연결" })).toBeEnabled();
```

Also assert that standalone mode still renders `AuthGate`, while CRM-embedded mode hides FIELD's logout button and Drive OAuth control.

- [ ] **Step 2: Run the component tests and verify RED**

```powershell
pnpm --dir company-site exec vitest run tests/field/desktop-bootstrap.test.tsx --reporter=verbose
```

Expected: FAIL because `DesktopFieldBootstrap` is missing.

- [ ] **Step 3: Implement the bootstrap state machine**

`DesktopFieldBootstrap` must:

- parse the handoff only once per URL;
- display `CRM 계정 연결 중` until Firebase `onAuthStateChanged` returns the exchanged user;
- render `<AuthGate><FieldWorkspace embeddedMode /></AuthGate>` after successful exchange;
- expose `다시 연결` by dispatching `bring-field-reconnect-request` for Electron to request a fresh handoff;
- install and clean up `observeDesktopLogout`;
- render fixed, non-sensitive Korean messages for expired, denied, and network failures.

In `FieldApp`, select the path without weakening standalone auth:

```tsx
const embeddedMode = typeof window !== "undefined"
  && new URL(window.location.href).searchParams.get("embedded") === "crm";

return embeddedMode
  ? <DesktopFieldBootstrap><FieldWorkspace embeddedMode /></DesktopFieldBootstrap>
  : <><FieldServiceWorker /><AuthGate><FieldWorkspace /></AuthGate></>;
```

Add `embeddedMode?: boolean` to `FieldWorkspaceProps`, default it to `false`, and pass it to `AppShell` so the component contract matches both branches.

Pass `embeddedMode` to `AppShell`; in embedded mode omit its logout button and `DriveConnectionControl`, because CRM owns logout and the server owns Drive OAuth.

- [ ] **Step 4: Add compact embedded layout styles**

Add a `.field-embedded` root modifier that removes duplicated page margins but does not change mobile standalone rules. Connection cards must be keyboard-readable and have `role="status"` or `role="alert"`.

- [ ] **Step 5: Run FIELD tests, lint, and typecheck**

```powershell
pnpm --dir company-site exec vitest run tests/field/desktop-bootstrap.test.tsx tests/field/auth-gate.test.tsx tests/field/mobile-layout.test.ts --reporter=verbose
pnpm --dir company-site exec eslint app/field/FieldApp.tsx app/field/components/DesktopFieldBootstrap.tsx app/field/components/AppShell.tsx app/field/lib/desktop-handoff.client.ts tests/field/desktop-handoff.test.ts tests/field/desktop-bootstrap.test.tsx
pnpm --dir company-site typecheck:field
```

Expected: focused tests pass, ESLint reports zero findings for changed files, and typecheck exits `0`.

- [ ] **Step 6: Commit the embedded FIELD UI**

```powershell
git add company-site/app/field/FieldApp.tsx company-site/app/field/components/DesktopFieldBootstrap.tsx company-site/app/field/components/AppShell.tsx company-site/app/field/field.css company-site/tests/field/desktop-bootstrap.test.tsx
git commit -m "feat: bootstrap FIELD inside BRING CRM"
```

### Task 6: Replace external launch with a sandboxed Electron WebContentsView

**Files:**
- Modify: `desktop-crm/src/remote.js`
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/src/preload.js`
- Modify: `desktop-crm/src/app.js`
- Modify: `desktop-crm/test/field-platform-entry.test.js`
- Create: `desktop-crm/test/field-web-contents.test.js`

- [ ] **Step 1: Rewrite the existing regression to require internal hosting**

Replace the old `shell.openExternal(FIELD_PLATFORM_URL)` expectation with:

```js
assert.match(main, /new WebContentsView\(/);
assert.match(main, /crm:show-field-platform/);
assert.match(main, /crm:hide-field-platform/);
assert.doesNotMatch(main, /shell\.openExternal\(FIELD_PLATFORM_URL\)/);
assert.doesNotMatch(preload, /openFieldPlatform:\s*\([^)]*url/);
```

In `field-web-contents.test.js`, import extracted pure helpers and assert:

```js
assert.equal(isAllowedFieldNavigation("https://bring-fm.web.app/field?embedded=crm"), true);
assert.equal(isAllowedFieldNavigation("https://evil.example/field"), false);
assert.deepEqual(fieldBounds({ width: 1518, height: 931 }), { x: 232, y: 115, width: 1286, height: 816 });
```

- [ ] **Step 2: Run Node tests and verify RED**

```powershell
npm --prefix desktop-crm test
```

Expected: FAIL because the code still opens Chrome and the view-policy helper is absent.

- [ ] **Step 3: Keep the CRM token inside `FirebaseRemoteClient`**

Add this method to `remote.js`:

```js
async createFieldHandoff() {
  const crmIdToken = await this.ensureIdToken(false);
  const response = await this.requestJson(FIELD_HANDOFF_CALLABLE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { crmIdToken } })
  }, "FIELD_HANDOFF_FAILED");
  const result = response && response.result;
  if (!result || !/^[A-Za-z0-9_-]{43}$/.test(result.code)) {
    throw createError("FIELD 연결 응답이 올바르지 않습니다.", "FIELD_HANDOFF_FAILED");
  }
  return { code: result.code, expiresAt: Number(result.expiresAt) };
}
```

Use the fixed callable URL `https://asia-northeast3-bring-fm.cloudfunctions.net/createDesktopFieldHandoff`. Never return `crmIdToken` or include it in an error.

- [ ] **Step 4: Add a focused view controller**

Extract pure exports into `desktop-crm/src/field-view-policy.js`:

```js
const FIELD_ORIGIN = "https://bring-fm.web.app";
const FIELD_BOUNDS = Object.freeze({ sidebar: 232, header: 115 });

function isAllowedFieldNavigation(rawUrl) {
  const url = new URL(rawUrl);
  return url.origin === FIELD_ORIGIN && url.pathname.startsWith("/field");
}

function fieldBounds(contentBounds) {
  return {
    x: FIELD_BOUNDS.sidebar,
    y: FIELD_BOUNDS.header,
    width: Math.max(0, contentBounds.width - FIELD_BOUNDS.sidebar),
    height: Math.max(0, contentBounds.height - FIELD_BOUNDS.header),
  };
}

module.exports = { FIELD_ORIGIN, isAllowedFieldNavigation, fieldBounds };
```

In `main.js`, construct `WebContentsView` with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and a dedicated `persist:bring-field` partition. Deny permission requests, `window.open`, downloads, non-FIELD navigation, and redirects. Load only:

```js
`${FIELD_PLATFORM_URL}?embedded=crm&desktop_handoff=${encodeURIComponent(code)}`
```

The main process owns show, hide, resize, reconnect, logout-event dispatch, and destruction. Renderer IPC accepts no URL or token parameters.

- [ ] **Step 5: Wire menu transitions**

Expose only:

```js
showFieldPlatform: () => ipcRenderer.invoke("crm:show-field-platform"),
hideFieldPlatform: () => ipcRenderer.invoke("crm:hide-field-platform"),
```

The FIELD menu awaits `showFieldPlatform()`. Every existing `[data-view]` navigation hides the view before rendering the CRM screen. `crm:auth-logout` dispatches `bring-crm-logout`, waits for completion, and destroys the view before clearing the CRM session.

- [ ] **Step 6: Run desktop tests and smoke build**

```powershell
npm --prefix desktop-crm test
npm --prefix desktop-crm run smoke
npm --prefix desktop-crm run build:win
```

Expected: Node tests pass, smoke exits `0`, and `desktop-crm/dist/BRING.CRM.exe` is produced.

- [ ] **Step 7: Commit the Electron integration**

```powershell
git add desktop-crm/src desktop-crm/test desktop-crm/package.json desktop-crm/package-lock.json
git commit -m "feat: host FIELD inside BRING CRM"
```

### Task 7: Full regression, security review, and deployment

**Files:**
- Modify: `company-site/firebase-public/**` through the existing export command
- Modify: `desktop-crm/package.json` version only

- [ ] **Step 1: Run the complete local regression suite**

```powershell
pnpm --dir functions test
pnpm --dir functions build
pnpm --dir company-site test:field:run
pnpm --dir company-site typecheck:field
npm --prefix desktop-crm test
npm --prefix desktop-crm run smoke
git diff --check
```

Expected: zero test failures, both TypeScript builds exit `0`, desktop smoke exits `0`, and diff check has no whitespace errors.

- [ ] **Step 2: Verify security invariants directly**

Run:

```powershell
rg -n "crmIdToken|customToken|desktop_handoff" desktop-crm/src company-site/app/field functions/src
rg -n "shell\.openExternal\(FIELD_PLATFORM_URL\)|nodeIntegration:\s*true|setWindowOpenHandler\([^}]*allow" desktop-crm/src
```

Expected: token names occur only at the defined server/main-process boundaries; no raw token logging, external FIELD launch, Node integration, or popup allow policy exists.

- [ ] **Step 3: Deploy the server and hosting in dependency order**

```powershell
firebase use bring-fm
firebase deploy --only functions:createDesktopFieldHandoff,functions:exchangeDesktopFieldHandoff,database
pnpm --dir company-site build
pnpm --dir company-site export:firebase
firebase deploy --only hosting
```

Expected: both callable deployments succeed before Hosting is updated. Standalone `https://bring-fm.web.app/field` still displays its normal login when opened outside CRM.

- [ ] **Step 4: Perform a production handoff canary**

Use the installed CRM account `bringengineering1008@gmail.com` and verify:

1. `BRING FIELD` does not open Chrome.
2. The FIELD workspace appears inside the CRM right pane.
3. No Google login control appears.
4. Map, capture target loading, gallery selection, upload summary, and ad package screens open.
5. Returning to `한눈에 보기` restores CRM immediately.
6. CRM logout removes the embedded FIELD session.
7. Direct mobile FIELD access still requires the existing company login.

- [ ] **Step 5: Bump and build desktop v1.6.0**

Set `desktop-crm/package.json` to `1.6.0`, then run:

```powershell
npm --prefix desktop-crm run build:win
Get-FileHash desktop-crm/dist/BRING.CRM.exe -Algorithm SHA256
```

Expected: installer, blockmap, and `latest.yml` all describe version `1.6.0`; record the SHA-256 in the release notes.

- [ ] **Step 6: Publish the desktop release and verify update assets**

Create GitHub release tag `crm-v1.6.0` with exactly:

- `BRING.CRM.exe`
- `BRING.CRM.exe.blockmap`
- `latest.yml`

Query the GitHub release API and require all three assets to have state `uploaded` and the local sizes before asking the running v1.5.0 client to update.

- [ ] **Step 7: Install only after explicit confirmation and verify the installed binary**

Because installing newly acquired software is a confirmation-required computer action, pause when the updater displays `지금 재시작`. After the user confirms, install and verify the running program reports v1.6.0 and completes the production canary above.

- [ ] **Step 8: Commit generated hosting output and the version bump**

```powershell
git add company-site/firebase-public desktop-crm/package.json desktop-crm/package-lock.json
git commit -m "release: prepare embedded FIELD desktop v1.6.0"
```

## Final acceptance checklist

- [ ] CRM requires only its existing employee login.
- [ ] FIELD never launches an external browser from the desktop menu.
- [ ] Embedded FIELD automatically receives a `bring-fm` session through a one-time code.
- [ ] Standalone FIELD keeps Google login and internal allowlist enforcement.
- [ ] CRM logout terminates embedded Firebase Auth without deleting pending media IndexedDB records.
- [ ] CRM tokens and custom tokens never enter renderer IPC, URLs, logs, or RTDB records.
- [ ] Photos, videos, upload counts, Drive sync, map, and ad packages work in the embedded view.
- [ ] Full Functions, FIELD, rules, desktop, build, and installed-binary verification passes.
