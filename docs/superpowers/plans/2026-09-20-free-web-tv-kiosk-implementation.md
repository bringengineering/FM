# BRING Free Web TV Kiosk Implementation Plan

> **For Codex:** Execute this plan task-by-task with test-driven development. Preserve the existing Electron TV path and all user-owned untracked verification directories.

**Goal:** Publish a free, same-origin web TV kiosk at the company Cloudflare Worker, pair it from BRING CRM, and run it automatically on a Windows TV computer without an EXE or code-signing certificate.

**Architecture:** Extend the existing wallboard Durable Object protocol with a `web` client type and a protected browser session cookie. Serve a static `/tv` shell and same-origin web pairing/display endpoints from the existing Worker. Reuse the current publication schema and scene vocabulary while rendering a browser-native, read-only dashboard. Update the CRM device panel so web devices show `웹 자동반영` and never expose Electron update controls.

**Tech Stack:** Cloudflare Workers, Durable Objects, vanilla HTML/CSS/JavaScript, Node.js built-in test runner, Electron CRM admin UI, PowerShell Windows startup scripts.

---

## Task 1: Add browser-session and client-type contracts

**Files:**
- Modify: `crm-ai-worker/src/wallboard-pairing.js`
- Modify: `crm-ai-worker/src/wallboard-devices.js`
- Test: `crm-ai-worker/test/wallboard-pairing.test.js`
- Test: `crm-ai-worker/test/wallboard-target.test.js`

**Step 1: Write failing tests**

Add cases proving:

- pairing can begin with `clientType: "web"`;
- approval records `clientType: "web"`;
- legacy devices without a type are returned as `electron`;
- `readBoard` for web devices omits Electron update instructions;
- list results include the normalized client type.

**Step 2: Run the focused tests and confirm failure**

Run: `npm test -- --test-name-pattern="web|client type|legacy"`

Expected: FAIL because the pairing service does not yet preserve or normalize `clientType`.

**Step 3: Implement the minimum contract change**

- Accept only `web` or `electron` when starting a pairing.
- Default missing values to `electron` for backward compatibility.
- Copy the pending client type into the approved device.
- Return `clientType` from device listing.
- Suppress update payload creation when `clientType === "web"`.

**Step 4: Re-run focused tests**

Run: `npm test -- --test-name-pattern="web|client type|legacy"`

Expected: PASS.

**Step 5: Commit**

```text
git add crm-ai-worker/src/wallboard-pairing.js crm-ai-worker/src/wallboard-devices.js crm-ai-worker/test/wallboard-pairing.test.js crm-ai-worker/test/wallboard-target.test.js
git commit -m "feat: add web wallboard device contract"
```

## Task 2: Add secure same-origin web pairing endpoints

**Files:**
- Modify: `crm-ai-worker/src/wallboard-http.js`
- Modify: `crm-ai-worker/src/index.js`
- Test: `crm-ai-worker/test/wallboard-http.test.js`
- Test: `crm-ai-worker/test/index.test.js`

**Step 1: Write failing HTTP tests**

Cover:

- `/tv/api/pair/start` creates a web pairing request;
- `/tv/api/pair/poll` sets an `HttpOnly; Secure; SameSite=Strict; Path=/tv` cookie after approval;
- the poll JSON never contains the raw device token;
- `/tv/api/display` reads the cookie and rejects missing, invalid, or revoked sessions;
- TV API responses use `Cache-Control: no-store` and do not emit CORS headers;
- state-changing browser requests with a foreign `Origin` are rejected.

**Step 2: Run tests to verify the red state**

Run: `npm test -- --test-name-pattern="tv api|cookie|same-origin"`

Expected: FAIL with missing routes and cookie behavior.

**Step 3: Implement route handlers**

- Keep existing `/v1/wallboard/*` admin/Electron endpoints unchanged.
- Add browser-only helpers for cookie parsing, origin validation, and cookie construction.
- Proxy browser commands through the existing Durable Object binding.
- Set the cookie only after a successful approved poll.
- Never serialize the raw token into a browser JSON response or logs.
- Clear the cookie when the session is invalid or revoked.

**Step 4: Re-run focused tests**

Run: `npm test -- --test-name-pattern="tv api|cookie|same-origin"`

Expected: PASS.

**Step 5: Commit**

```text
git add crm-ai-worker/src/wallboard-http.js crm-ai-worker/src/index.js crm-ai-worker/test/wallboard-http.test.js crm-ai-worker/test/index.test.js
git commit -m "feat: secure web wallboard sessions"
```

## Task 3: Serve the BRING web TV shell

**Files:**
- Create: `crm-ai-worker/src/wallboard-web-assets.js`
- Modify: `crm-ai-worker/src/index.js`
- Test: `crm-ai-worker/test/wallboard-web.test.js`

**Step 1: Write failing asset and security tests**

Assert that:

- `GET /tv` and `/tv/` return the kiosk HTML;
- `GET /tv/app.css` and `/tv/app.js` return the expected media types;
- HTML uses the existing BRING visual language and contains no secret, admin token, customer phone, or detailed address fixtures;
- CSP blocks external scripts, frames, objects, and arbitrary connections;
- static assets use short revalidation caching while API responses remain `no-store`.

**Step 2: Confirm tests fail**

Run: `node --test test/wallboard-web.test.js`

Expected: FAIL because the assets do not exist.

**Step 3: Implement static asset responses**

- Export immutable HTML, CSS, and JavaScript strings from `wallboard-web-assets.js`.
- Route only exact `/tv`, `/tv/`, `/tv/app.css`, `/tv/app.js` paths.
- Add CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and frame protection headers.
- Do not depend on third-party fonts, scripts, images, or CDNs.

**Step 4: Re-run focused tests**

Run: `node --test test/wallboard-web.test.js`

Expected: PASS.

**Step 5: Commit**

```text
git add crm-ai-worker/src/wallboard-web-assets.js crm-ai-worker/src/index.js crm-ai-worker/test/wallboard-web.test.js
git commit -m "feat: serve BRING web TV kiosk"
```

## Task 4: Implement pairing, safe rendering, rotation, and offline recovery

**Files:**
- Modify: `crm-ai-worker/src/wallboard-web-assets.js`
- Test: `crm-ai-worker/test/wallboard-web.test.js`
- Reference: `desktop-crm/src/company-wallboard.js`
- Reference: `desktop-crm/src/company-wallboard-theme.css`
- Reference: `desktop-crm/src/wallboard-tv-renderer.js`

**Step 1: Extend failing behavior tests**

Test exported pure helpers or source contracts for:

- eight-character pairing-code display;
- safe text rendering without `innerHTML` for publication content;
- exactly five supported scenes;
- timed rotation and manual next/previous controls;
- 15-second publication refresh;
- last validated public snapshot cache and reconnect banner;
- local snapshot removal and return to pairing when the server reports revocation;
- no customer phone, consultation text, access information, credentials, or detailed address fields are rendered.

**Step 2: Confirm failures**

Run: `node --test test/wallboard-web.test.js`

Expected: FAIL for unimplemented kiosk behavior.

**Step 3: Implement the renderer**

- Use DOM creation and `textContent` for all server-sourced values.
- Reuse the five scene names and status calculations from the existing wallboard.
- Store only the last validated public snapshot in browser storage.
- Poll pairing while unapproved and display data while approved.
- Rotate scenes automatically and pause rotation while the document is hidden.
- Show small connection and last-updated indicators without obscuring the board.
- Keep layout responsive for 1280×720 and 1920×1080 at 100% zoom.

**Step 4: Run focused tests**

Run: `node --test test/wallboard-web.test.js`

Expected: PASS.

**Step 5: Commit**

```text
git add crm-ai-worker/src/wallboard-web-assets.js crm-ai-worker/test/wallboard-web.test.js
git commit -m "feat: render rotating web TV dashboard"
```

## Task 5: Make CRM web-device management clear and safe

**Files:**
- Modify: `desktop-crm/src/wallboard-admin-client.js`
- Modify: `desktop-crm/src/wallboard-admin-ui.js`
- Test: `desktop-crm/test/wallboard-admin-client.test.js`
- Test: `desktop-crm/test/wallboard-tv-client.test.js`

**Step 1: Write failing CRM tests**

Prove that:

- list parsing preserves normalized `clientType`;
- web devices render a `웹 자동반영` label;
- web devices never render schedule/cancel EXE update buttons;
- Electron devices keep existing version and update controls;
- the approval copy instructs users to open the free web TV address.

**Step 2: Confirm tests fail**

Run: `node --test test/wallboard-admin-client.test.js test/wallboard-tv-client.test.js`

Expected: FAIL because all devices are currently treated as Electron clients.

**Step 3: Implement the UI distinction**

- Parse `clientType` defensively, defaulting missing values to `electron`.
- Show web connection state and last contact time.
- Hide update version/status/actions for web devices.
- Keep revoke, refresh, approve, and publish actions common to both device types.
- Add the fixed `/tv` URL as non-secret setup guidance.

**Step 4: Re-run focused tests**

Run: `node --test test/wallboard-admin-client.test.js test/wallboard-tv-client.test.js`

Expected: PASS.

**Step 5: Commit**

```text
git add desktop-crm/src/wallboard-admin-client.js desktop-crm/src/wallboard-admin-ui.js desktop-crm/test/wallboard-admin-client.test.js desktop-crm/test/wallboard-tv-client.test.js
git commit -m "feat: manage web TV devices in CRM"
```

## Task 6: Add Windows Edge kiosk setup and removal scripts

**Files:**
- Create: `release/install-bring-tv-web-kiosk.ps1`
- Create: `release/uninstall-bring-tv-web-kiosk.ps1`
- Create: `release/README-tv-web-kiosk.md`
- Test: `desktop-crm/test/tv-web-kiosk-scripts.test.js`

**Step 1: Write failing script contract tests**

Check that:

- install targets only the current user's Startup folder;
- the shortcut launches Edge with `--kiosk`, the fixed HTTPS `/tv` URL, and no user-supplied URL;
- Edge path discovery fails cleanly before writing a shortcut;
- uninstall removes only the BRING TV shortcut;
- neither script deletes browser profiles, cookies, downloads, or unrelated shortcuts.

**Step 2: Confirm test failure**

Run: `node --test test/tv-web-kiosk-scripts.test.js`

Expected: FAIL because scripts are absent.

**Step 3: Implement scripts and operator guide**

- Resolve Edge from standard installed locations.
- Create a `.lnk` in the current user Startup folder via `WScript.Shell`.
- Use the fixed production Worker `/tv` URL.
- Make re-running install idempotent.
- Make removal idempotent and narrowly scoped.
- Document first pairing, CRM approval, reboot verification, and revocation.

**Step 4: Run focused tests**

Run: `node --test test/tv-web-kiosk-scripts.test.js`

Expected: PASS.

**Step 5: Commit**

```text
git add release/install-bring-tv-web-kiosk.ps1 release/uninstall-bring-tv-web-kiosk.ps1 release/README-tv-web-kiosk.md desktop-crm/test/tv-web-kiosk-scripts.test.js
git commit -m "feat: add Windows web TV kiosk setup"
```

## Task 7: Run regression, privacy, and deployment verification

**Files:**
- Modify if required: `crm-ai-worker/README.md`
- Modify if required: `crm-ai-worker/test/deployment-config.test.js`
- Modify if required: `desktop-crm/test/tv-update-policy.test.js`

**Step 1: Run Worker regression**

Run: `npm test`

Working directory: `crm-ai-worker`

Expected: all Worker tests pass, including existing Electron wallboard tests.

**Step 2: Run CRM regression**

Run: `npm test`

Working directory: `desktop-crm`

Expected: all CRM tests pass.

**Step 3: Review privacy boundary**

Search the generated TV assets for credentials, raw pairing tokens, customer phones, detailed address fixtures, and admin-only fields. Confirm the public shell contains none.

**Step 4: Validate deployment configuration**

Run: `npx wrangler deploy --dry-run`

Working directory: `crm-ai-worker`

Expected: Worker bundle builds with the existing Durable Object binding and no Firebase Functions/Hosting deployment.

**Step 5: Commit documentation or compatibility fixes**

```text
git add crm-ai-worker/README.md crm-ai-worker/test/deployment-config.test.js desktop-crm/test/tv-update-policy.test.js
git commit -m "docs: finalize free web TV operations"
```

Skip this commit if no file changed.

## Task 8: Review, publish PR, deploy Worker, and probe production

**Files:**
- Review: all branch changes

**Step 1: Inspect the branch diff**

Run: `git status --short` and `git diff origin/codex/bring-field-platform...HEAD --check`

Expected: only intended files changed; the two pre-existing untracked verification directories remain untouched.

**Step 2: Perform code review**

Review authentication boundaries, cookie flags, legacy Electron compatibility, DOM safety, privacy filtering, failure states, and Windows script scope. Fix findings with tests first.

**Step 3: Push and open a pull request**

Push `codex/free-web-tv-kiosk`, create a PR into `codex/bring-field-platform`, and attach the PR to the task.

**Step 4: Monitor required checks**

Wait until the PR checks complete. Do not merge while checks fail or are pending.

**Step 5: Deploy only the existing Cloudflare Worker after merge approval**

Run: `npm run deploy`

Working directory: `crm-ai-worker`

Do not deploy Firebase Functions or Firebase Hosting.

**Step 6: Probe production**

Verify:

- `GET https://bring-crm-ai-gateway.bringengineering1008.workers.dev/tv` returns the kiosk with security headers;
- anonymous display access is rejected;
- pairing start returns a code but no raw device token in browser JSON after approval;
- a revoked test device cannot read the display;
- existing `/health` and admin wallboard routes still respond as expected.

**Step 7: Complete the Windows TV handoff**

On the TV computer, run the install script once, approve the displayed code in CRM, reboot, and complete the 720p/1080p acceptance checklist. This is the only physical-device step that requires access to that Windows computer.
