# TV Wallboard Live CRM Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the latest shared CRM projects, work orders, staff performance, and schedules automatically and show them on approved TV dashboards within ten seconds without exposing CRM credentials to the TV.

**Architecture:** Add one main-process live-sync controller that reacts to authenticated remote sync success, coalesces repeated changes, rebuilds a sanitized snapshot from the shared server, and publishes with one conflict-safe retry. Preserve the presentation settings already stored by the wallboard service, and reduce both web and Electron TV polling to ten seconds while retaining the last valid board during outages.

**Tech Stack:** Electron, Node.js CommonJS, Cloudflare Workers/Durable Objects, Firebase Realtime Database REST client, vanilla JavaScript, Node test runner

---

## File structure

- Create `desktop-crm/src/wallboard-live-sync.js`: authenticated background reconciliation, debounce, periodic fallback, fingerprinting, conflict retry, and observable status.
- Create `desktop-crm/test/wallboard-live-sync.test.js`: deterministic controller tests with fake clocks and fake server dependencies.
- Modify `desktop-crm/src/main.js`: start/stop the controller with authentication, notify it from successful shared-server sync, and expose status/manual sync through existing wallboard IPC.
- Modify `desktop-crm/src/wallboard-admin-client.js`: validate the server-preserved presentation returned by the administrator list endpoint.
- Modify `desktop-crm/src/wallboard-admin-ui.js`: replace manual one-minute publishing controls with live status and a `지금 동기화` recovery action while retaining explicit device approval and manual board publishing.
- Modify `desktop-crm/src/wallboard-tv-renderer.js`: poll a published board every ten seconds.
- Modify `desktop-crm/test/wallboard-admin-client.test.js` and `desktop-crm/test/wallboard-tv-client.test.js`: verify presentation preservation and ten-second polling.
- Modify `crm-ai-worker/src/wallboard-pairing.js`: return only the current playlist and notice to authenticated administrators during list calls.
- Modify `crm-ai-worker/src/wallboard-web-assets.js`: poll the board every ten seconds.
- Modify `crm-ai-worker/test/wallboard-publication.test.js` and `crm-ai-worker/test/wallboard-web.test.js`: verify safe presentation retrieval and ten-second web polling.

### Task 1: Build the live-sync controller with deterministic tests

**Files:**
- Create: `desktop-crm/src/wallboard-live-sync.js`
- Create: `desktop-crm/test/wallboard-live-sync.test.js`

- [ ] **Step 1: Write failing tests for startup, coalescing, conflict recovery, unchanged snapshots, and authentication loss**

```js
test('authenticated start publishes current shared CRM data and schedules reconciliation', async () => {
  const fixture = createFixture();
  fixture.sync.start();
  await fixture.flush();
  assert.equal(fixture.published.length, 1);
  assert.equal(fixture.published[0].snapshot.model.total, 1);
  assert.equal(fixture.sync.status().active, true);
});

test('multiple remote success notifications coalesce into one publication', async () => {
  const fixture = createFixture();
  fixture.sync.start();
  await fixture.flush();
  fixture.sync.notify();
  fixture.sync.notify();
  fixture.sync.notify();
  await fixture.flushDebounce();
  assert.equal(fixture.published.length, 2);
});

test('version conflict reloads current version and retries once', async () => {
  const fixture = createFixture({ conflictOnce: true });
  fixture.sync.start();
  await fixture.flush();
  assert.equal(fixture.published.length, 2);
  assert.equal(fixture.sync.status().error, '');
});

test('unchanged source is not republished', async () => {
  const fixture = createFixture();
  fixture.sync.start();
  await fixture.flush();
  fixture.sync.notify();
  await fixture.flushDebounce();
  assert.equal(fixture.published.length, 1);
});

test('authentication loss stops timers and preserves the last successful status', async () => {
  const fixture = createFixture();
  fixture.sync.start();
  await fixture.flush();
  fixture.identity.value = '';
  fixture.sync.notify();
  await fixture.flushDebounce();
  assert.equal(fixture.sync.status().active, false);
  assert.equal(fixture.sync.status().error, 'AUTH_REQUIRED');
});
```

- [ ] **Step 2: Run the new test and verify it fails because the controller does not exist**

Run: `cd desktop-crm && node --test test/wallboard-live-sync.test.js`

Expected: FAIL with `Cannot find module '../src/wallboard-live-sync'`.

- [ ] **Step 3: Implement the minimal controller**

```js
'use strict';
const { project } = require('./company-wallboard');
const { validatePublication } = require('./wallboard-publication-schema');

const defaultPlaylist = [
  ['roadmap', 40], ['portfolio', 25], ['weeklyTrend', 20], ['health', 20],
  ['milestones', 25], ['scheduleToday', 30], ['scheduleWeek', 30],
  ['people', 25], ['issues', 20], ['notice', 30]
].map(([key, seconds]) => ({ key, enabled: true, seconds }));

function createWallboardLiveSync(options) {
  const {
    getIdentity, load, list, publish, now = () => new Date(),
    setIntervalFn = setInterval, clearIntervalFn = clearInterval,
    setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout,
    onStatus = () => {}
  } = options;
  let active = false, busy = false, periodic = null, debounce = null;
  let fingerprint = '', version = null, publishedAt = null, error = '';

  const state = () => ({ active, busy, version, publishedAt, error });
  const emit = () => { const value = state(); onStatus(value); return value; };
  const stop = code => {
    active = false;
    if (periodic !== null) clearIntervalFn(periodic);
    if (debounce !== null) clearTimeoutFn(debounce);
    periodic = debounce = null;
    if (code) error = code;
    return emit();
  };
  const build = async presentation => {
    const data = await load();
    const date = now();
    const dataDate = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    return validatePublication({
      model: project(data, dataDate),
      playlist: presentation?.playlist || defaultPlaylist,
      notice: presentation?.notice || '',
      dataDate
    });
  };
  async function reconcile() {
    if (!active || busy) return state();
    const owner = getIdentity();
    if (!owner) return stop('AUTH_REQUIRED');
    busy = true; emit();
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await list(owner);
        const snapshot = await build(current.presentation);
        const nextFingerprint = JSON.stringify(snapshot);
        if (nextFingerprint === fingerprint) { error = ''; break; }
        try {
          const result = await publish({ action: 'publish', snapshot, expectedVersion: current.version }, owner);
          fingerprint = nextFingerprint;
          version = result.version;
          publishedAt = result.publishedAt;
          error = '';
          break;
        } catch (publishError) {
          if (publishError?.code !== 'VERSION_CONFLICT' || attempt === 1) throw publishError;
        }
      }
    } catch (cause) {
      error = ['AUTH_REQUIRED', 'FORBIDDEN', 'VERSION_CONFLICT'].includes(cause?.code) ? cause.code : 'SOURCE_OR_SERVER_UNAVAILABLE';
      if (['AUTH_REQUIRED', 'FORBIDDEN'].includes(error)) stop(error);
    } finally {
      busy = false;
      emit();
    }
    return state();
  }
  function notify() {
    if (!active) return state();
    if (debounce !== null) clearTimeoutFn(debounce);
    debounce = setTimeoutFn(() => { debounce = null; void reconcile(); }, 300);
    return state();
  }
  function start() {
    if (active) return state();
    if (!getIdentity()) { error = 'AUTH_REQUIRED'; return emit(); }
    active = true; error = '';
    periodic = setIntervalFn(() => void reconcile(), 60000);
    periodic?.unref?.();
    void reconcile();
    return emit();
  }
  return { start, stop: () => stop(''), notify, reconcile, status: state };
}

module.exports = { createWallboardLiveSync, defaultPlaylist };
```

- [ ] **Step 4: Run the controller tests and correct only contract-level defects**

Run: `cd desktop-crm && node --test test/wallboard-live-sync.test.js`

Expected: all live-sync tests PASS.

- [ ] **Step 5: Commit the controller**

```bash
git add desktop-crm/src/wallboard-live-sync.js desktop-crm/test/wallboard-live-sync.test.js
git commit -m "feat: reconcile live CRM data to TV wallboard"
```

### Task 2: Preserve the current TV presentation in the Worker administrator response

**Files:**
- Modify: `crm-ai-worker/src/wallboard-pairing.js`
- Modify: `crm-ai-worker/test/wallboard-publication.test.js`
- Modify: `desktop-crm/src/wallboard-admin-client.js`
- Modify: `desktop-crm/test/wallboard-admin-client.test.js`

- [ ] **Step 1: Add failing tests for safe presentation retrieval**

```js
test('administrator list returns presentation settings without the CRM model', async () => {
  await service.publish(snapshot(), 0, admin);
  const result = await service.list(admin);
  assert.deepEqual(result.presentation, {
    playlist: snapshot().playlist,
    notice: snapshot().notice
  });
  assert.equal('model' in result, false);
});
```

The desktop client test must assert that `requestWallboardAdmin({ action: 'list' })` accepts only the validated playlist and bounded notice, and rejects unknown scene keys or unexpected properties.

- [ ] **Step 2: Run both tests and verify the missing presentation assertion fails**

Run: `cd crm-ai-worker && node --test test/wallboard-publication.test.js`

Run: `cd desktop-crm && node --test test/wallboard-admin-client.test.js`

Expected: at least one assertion FAILS because `presentation` is absent.

- [ ] **Step 3: Return and validate only presentation settings**

Change `list(identity)` to include:

```js
presentation: s.board ? {
  playlist: structuredClone(s.board.playlist),
  notice: s.board.notice
} : null
```

In the desktop administrator client, normalize the response to:

```js
const presentation = data.presentation === null ? null : validatePresentation(data.presentation);
return { ok: true, version: data.version, presentation, devices };
```

`validatePresentation` must reuse `validatePublication` with an empty known-good model and fixed date, return only `{ playlist, notice }`, and reject unexpected fields.

- [ ] **Step 4: Run the focused Worker and desktop tests**

Run: `cd crm-ai-worker && node --test test/wallboard-publication.test.js`

Run: `cd desktop-crm && node --test test/wallboard-admin-client.test.js`

Expected: all focused tests PASS.

- [ ] **Step 5: Commit presentation preservation**

```bash
git add crm-ai-worker/src/wallboard-pairing.js crm-ai-worker/test/wallboard-publication.test.js desktop-crm/src/wallboard-admin-client.js desktop-crm/test/wallboard-admin-client.test.js
git commit -m "feat: preserve TV presentation during live sync"
```

### Task 3: Wire authenticated CRM sync events to automatic publication

**Files:**
- Modify: `desktop-crm/src/main.js`
- Modify: `desktop-crm/test/project-wiring.test.js`

- [ ] **Step 1: Add a failing static wiring test**

```js
test('authenticated shared CRM sync drives live wallboard reconciliation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.match(source, /createWallboardLiveSync/);
  assert.match(source, /wallboardLiveSync\.start\(\)/);
  assert.match(source, /state\?\.status === ['"]connected['"]/);
  assert.match(source, /wallboardLiveSync\?\.notify\(\)/);
  assert.match(source, /action === ['"]live-sync['"]/);
  assert.match(source, /action === ['"]live-status['"]/);
});
```

- [ ] **Step 2: Run the wiring test and verify failure**

Run: `cd desktop-crm && node --test test/project-wiring.test.js`

Expected: FAIL because live-sync wiring is absent.

- [ ] **Step 3: Instantiate and control the live-sync controller in `main.js`**

Add one `wallboardLiveSync` variable beside `wallboardPublisher`. Add a lazy initializer that supplies:

```js
{
  getIdentity: () => remoteClient?.authState().user?.mustChangePassword ? '' : String(remoteClient?.authState().user?.uid || ''),
  load: () => loadWallboardSource(remoteClient),
  list: async () => requestWallboardAdmin({ baseUrl: CRM_AI_GATEWAY_URL, idToken: await remoteClient.ensureIdToken(false), input: { action: 'list' }, fetchImpl: (url, options) => net.fetch(url, options) }),
  publish: async publication => requestWallboardAdmin({ baseUrl: CRM_AI_GATEWAY_URL, idToken: await remoteClient.ensureIdToken(false), input: publication, fetchImpl: (url, options) => net.fetch(url, options) })
}
```

In `onAuthState`, start the controller for a valid non-password-change session and stop it otherwise. In `onSyncState`, forward the state to the renderer and call `notify()` only for `state?.status === 'connected'`.

Extend `crm:wallboard-admin` with:

```js
if (input?.action === 'live-status') return ensureWallboardLiveSync().status();
if (input?.action === 'live-sync') return ensureWallboardLiveSync().reconcile();
```

- [ ] **Step 4: Run wiring and publisher regression tests**

Run: `cd desktop-crm && node --test test/project-wiring.test.js test/wallboard-publisher.test.js test/wallboard-admin-client.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit main-process wiring**

```bash
git add desktop-crm/src/main.js desktop-crm/test/project-wiring.test.js
git commit -m "feat: publish wallboard after CRM server sync"
```

### Task 4: Replace manual timer controls with live status and recovery

**Files:**
- Modify: `desktop-crm/src/wallboard-admin-ui.js`
- Modify: `desktop-crm/test/wallboard-admin-client.test.js`

- [ ] **Step 1: Add failing UI tests for live state and manual recovery**

```js
test('wallboard administrator UI shows live sync state and manual recovery', async () => {
  const dom = new JSDOM('<main></main>', { runScripts: 'outside-only' });
  const w = dom.window as any;
  w.eval(fs.readFileSync(path.resolve('../desktop-crm/src/wallboard-admin-ui.js'), 'utf8'));
  const calls: any[] = [];
  const host = w.document.querySelector('main');
  const stop = w.BringWallboardAdmin.mount(host, {
    request: async (input: any) => {
      calls.push(input);
      if (input.action === 'list') return { version: 1, devices: [] };
      if (input.action === 'live-status') return { active: true, busy: false, version: 2, publishedAt: 1000, error: '' };
      if (input.action === 'live-sync') return { active: true, busy: false, version: 3, publishedAt: 2000, error: '' };
      return { ok: true };
    }
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(host.textContent).toContain('실시간 반영 중');
  expect(host.querySelector('[data-live-sync]')).not.toBeNull();
  expect(host.querySelector('[data-auto-start]')).toBeNull();
  expect(host.querySelector('[data-auto-stop]')).toBeNull();
  host.querySelector('[data-live-sync]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(calls).toContainEqual({ action: 'live-sync' });
  stop();
  dom.window.close();
});
```

- [ ] **Step 2: Run the UI test and verify failure**

Run: `cd desktop-crm && node --test test/wallboard-admin-client.test.js`

Expected: FAIL because the old one-minute controls are still rendered.

- [ ] **Step 3: Implement the status block**

Render:

```html
<div class="wb-controls wb-live-sync">
  <strong data-live-state>실시간 반영 확인 중…</strong>
  <button type="button" data-live-sync>지금 동기화</button>
  <small>공용 서버 저장 후 승인된 TV에 자동 반영됩니다.</small>
</div>
```

Poll `{ action: 'live-status' }` every 15 seconds. Map controller status to `실시간 반영 중`, `반영 중`, `권한 확인`, and `연결 확인 필요`. The manual button sends `{ action: 'live-sync' }` and then refreshes the status. Keep device approval, device list, explicit current-board publishing, and device revocation unchanged.

- [ ] **Step 4: Run the UI and company-site compatibility tests**

Run: `cd desktop-crm && node --test test/wallboard-admin-client.test.js`

Run: `cd company-site && npm test -- --run tests/field/wallboard-admin.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 5: Commit the live status UI**

```bash
git add desktop-crm/src/wallboard-admin-ui.js desktop-crm/test/wallboard-admin-client.test.js company-site/tests/field/wallboard-admin.test.ts
git commit -m "feat: show live TV synchronization status"
```

### Task 5: Reduce TV publication polling to ten seconds

**Files:**
- Modify: `desktop-crm/src/wallboard-tv-renderer.js`
- Modify: `desktop-crm/test/wallboard-tv-client.test.js`
- Modify: `crm-ai-worker/src/wallboard-web-assets.js`
- Modify: `crm-ai-worker/test/wallboard-web.test.js`

- [ ] **Step 1: Change tests to require ten-second polling**

```js
assert.match(source, /setInterval\(\(\)=>\{if\(!pendingToken\)void refresh\(\);\},10000\)/);
```

The Electron renderer test must advance its five-second timer twice and assert exactly one display refresh after the initial load.

- [ ] **Step 2: Run the focused tests and verify failure at the old 15/60-second intervals**

Run: `cd crm-ai-worker && node --test test/wallboard-web.test.js`

Run: `cd desktop-crm && node --test test/wallboard-tv-client.test.js`

Expected: FAIL on the polling interval assertions.

- [ ] **Step 3: Implement ten-second polling without changing scene rotation**

In the web asset, change only the board refresh interval from `15000` to `10000`. In the Electron renderer, change the five-second tick threshold from `12` to `2`. Keep pairing polling, application version polling, scene duration, cache validation, and offline fallback unchanged.

- [ ] **Step 4: Run focused TV tests**

Run: `cd crm-ai-worker && node --test test/wallboard-web.test.js test/wallboard-publication.test.js test/wallboard-pairing.test.js`

Run: `cd desktop-crm && node --test test/wallboard-tv-client.test.js test/company-wallboard.test.js`

Expected: all focused tests PASS.

- [ ] **Step 5: Commit TV polling changes**

```bash
git add desktop-crm/src/wallboard-tv-renderer.js desktop-crm/test/wallboard-tv-client.test.js crm-ai-worker/src/wallboard-web-assets.js crm-ai-worker/test/wallboard-web.test.js
git commit -m "feat: refresh TV wallboard within ten seconds"
```

### Task 6: Verify the complete data path and regression safety

**Files:**
- Verify: `desktop-crm/src/wallboard-live-sync.js`
- Verify: `desktop-crm/src/main.js`
- Verify: `desktop-crm/src/wallboard-admin-ui.js`
- Verify: `desktop-crm/src/wallboard-tv-renderer.js`
- Verify: `crm-ai-worker/src/wallboard-pairing.js`
- Verify: `crm-ai-worker/src/wallboard-web-assets.js`

- [ ] **Step 1: Run desktop wallboard and wiring suites**

Run: `cd desktop-crm && node --test test/wallboard-live-sync.test.js test/wallboard-publisher.test.js test/wallboard-admin-client.test.js test/wallboard-tv-client.test.js test/company-wallboard.test.js test/project-wiring.test.js test/work-order-wiring.test.js test/building-schedule-commit.test.js`

Expected: all tests PASS.

- [ ] **Step 2: Run Worker wallboard suites**

Run: `cd crm-ai-worker && node --test test/wallboard-web.test.js test/wallboard-publication.test.js test/wallboard-pairing.test.js`

Expected: all tests PASS.

- [ ] **Step 3: Run full desktop and Worker test suites**

Run: `cd desktop-crm && npm test`

Run: `cd crm-ai-worker && npm test`

Expected: no failing tests; existing intentional skips may remain.

- [ ] **Step 4: Verify diff safety**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors; only intended tracked files plus the pre-existing unrelated untracked verification/release artifacts.

- [ ] **Step 5: Commit any test-only corrections**

```bash
git add desktop-crm/src desktop-crm/test crm-ai-worker/src crm-ai-worker/test company-site/tests/field/wallboard-admin.test.ts
git commit -m "test: verify live TV wallboard data flow"
```

### Task 7: Prepare review without production deployment

**Files:**
- Update: `docs/superpowers/plans/2026-09-23-tv-wallboard-live-crm-data.md`

- [ ] **Step 1: Mark completed checkboxes and record exact test totals**

Add a short verification section containing the commands, pass counts, skip counts, and any environment-only limitation.

- [ ] **Step 2: Push the current feature branch without force**

Run: `git push origin codex/free-web-tv-kiosk`

Expected: fast-forward update succeeds.

- [ ] **Step 3: Attach or update the existing pull request**

Use PR `https://github.com/bringengineering/FM/pull/122`. Do not deploy the Worker, move existing tags, or merge the production branch in this task.

- [ ] **Step 4: Report acceptance steps**

The handoff must state: open CRM, save a project/work order/schedule, keep one approved TV page open, and confirm the corresponding value changes within ten seconds after the live publisher succeeds.
