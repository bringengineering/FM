# TV Roadmap, Performance, and Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CRM project-roadmap, project-performance, milestone, today-schedule, and week-schedule scenes to the paired BRING TV wallboard without exposing customer-private fields.

**Architecture:** Extend the existing server-only wallboard projection in `company-wallboard.js`, validate the expanded publication at both publisher and TV boundaries, and render the same sanitized model in the CRM preview and public Worker TV client. Keep the existing Durable Object pairing, one-minute publisher, 15-second board polling, and 60-second zero-touch web update unchanged.

**Tech Stack:** Electron renderer JavaScript, Node test runner, Cloudflare Worker/Durable Object, HTML/CSS/vanilla JavaScript.

---

## File map

- Modify `desktop-crm/src/company-wallboard.js`: produce sanitized roadmap, portfolio, milestone, and schedule projections; render CRM preview scenes.
- Modify `desktop-crm/src/company-wallboard.css`: roadmap, right-side KPI rail, charts, health cards, and schedule-grid layout.
- Modify `desktop-crm/src/company-wallboard-theme.css`: map new components to the existing Toss-style CRM tokens.
- Modify `desktop-crm/src/wallboard-publication-schema.js`: strictly validate the expanded model and ten scene keys.
- Modify `desktop-crm/src/wallboard-publisher.js`: continue loading projects/orders from `loadWorkOrders` and sanitized schedules from the server without loading or mutating the local CRM store.
- Modify `crm-ai-worker/src/wallboard-web-assets.js`: validate and render the new public TV scenes and update the web-app version.
- Modify `desktop-crm/test/company-wallboard.test.js`: projection and HTML behavior.
- Modify `desktop-crm/test/wallboard-publisher.test.js`: publisher source and expanded snapshot behavior.
- Modify `crm-ai-worker/test/wallboard-publication.test.js`: allowlist and privacy validation.
- Modify `crm-ai-worker/test/wallboard-web.test.js`: public TV assets, scenes, and zero-touch update regression.

### Task 1: Project roadmap projection

**Files:**
- Modify: `desktop-crm/src/company-wallboard.js`
- Test: `desktop-crm/test/company-wallboard.test.js`

- [ ] **Step 1: Write failing projection tests**

Add tests that provide `projects`, `orders`, and `members` and assert:

```js
test('roadmap projects dates and entered progress without private fields', () => {
  const model = C.project({
    projects: [{id:'p1',name:'디지털 트윈',status:'active',startDate:'2026-09-01',endDate:'2026-10-02',progress:40,goal:'private goal'}],
    orders: [{id:'o1',projectId:'p1',status:'doing',progress:60,assigneeUid:'u1',assigneeName:'황우중',startDate:'2026-09-08',dueDate:'2026-09-18',title:'private task'}],
    members: [{uid:'u1',displayName:'황우중',email:'private@example.com'}],
    calendar: {serviceRecords: []}
  }, '2026-09-20');
  assert.equal(model.roadmap.lanes[0].assigneeName, '황우중');
  assert.equal(model.roadmap.lanes[0].assignments[0].projectName, '디지털 트윈');
  assert.equal(model.roadmap.lanes[0].assignments[0].progress, 60);
  assert.ok(!JSON.stringify(model).includes('private task'));
  assert.ok(!JSON.stringify(model).includes('private@example.com'));
  assert.ok(!JSON.stringify(model).includes('private goal'));
});
```

Also test three-person paging, undated projects, date clipping, completed projects, overdue projects, and unknown assignees.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
cd desktop-crm
node --test test/company-wallboard.test.js
```

Expected: FAIL because `model.roadmap` and `model.portfolio` do not exist.

- [ ] **Step 3: Add pure projection helpers**

Add bounded helpers inside `company-wallboard.js`:

```js
const percent = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
const publicText = (value, max) => String(value == null ? '' : value).trim().slice(0, max);
const activeProject = item => item && item.status !== 'done';
const projectHealth = (project, orders, today) => {
  if (project.status === 'done' || (orders.length && orders.every(item => item.status === 'done'))) return 'done';
  if ((project.endDate && project.endDate < today) || orders.some(item => item.status !== 'done' && item.dueDate && item.dueDate < today)) return 'risk';
  if (orders.some(item => item.status !== 'done' && (!item.dueDate || item.dueDate <= addDays(today, 7)))) return 'check';
  return 'normal';
};
```

Produce `roadmap.range`, `roadmap.lanes`, and `roadmap.assignments` using the same eight-week and progress rules as `project-core.js`. Copy only the allowlisted public fields named in the design spec.

- [ ] **Step 4: Run the focused test and verify pass**

Run the same command. Expected: all `company-wallboard` tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add desktop-crm/src/company-wallboard.js desktop-crm/test/company-wallboard.test.js
git commit -m "feat: project roadmap for TV wallboard"
```

### Task 2: Portfolio, milestones, and weekly completion projection

**Files:**
- Modify: `desktop-crm/src/company-wallboard.js`
- Test: `desktop-crm/test/company-wallboard.test.js`

- [ ] **Step 1: Write failing KPI tests**

Add tests asserting:

```js
assert.deepEqual(model.portfolio.healthCounts, {normal:1, check:1, risk:1, done:1});
assert.equal(model.portfolio.overallProgress, 45);
assert.deepEqual(model.portfolio.weeklyDone.map(item => item.count), [0,1,0,2,1]);
assert.deepEqual(model.portfolio.milestones[0], {
  title:'현장 데이터 확보', projectName:'디지털 트윈', owner:'황우중', dueDate:'2026-09-21', daysLeft:1
});
```

The fixtures must include one active project without orders to verify that its own manual progress is used, while a project with orders uses the order-progress average.

- [ ] **Step 2: Run the focused test and verify failure**

```powershell
cd desktop-crm
node --test test/company-wallboard.test.js
```

Expected: FAIL on missing portfolio fields.

- [ ] **Step 3: Implement portfolio aggregation**

Implement:

```js
function portfolio(projects, orders, today) {
  const rows = normalizedProjects.map(project => {
    const linked = normalizedOrders.filter(order => order.projectId === project.id);
    const progress = linked.length
      ? Math.round(linked.reduce((sum, order) => sum + percent(order.progress), 0) / linked.length)
      : percent(project.progress);
    return {name: publicText(project.name,120), owner: publicText(project.owner,80), progress,
      health: projectHealth(project, linked, today), open: linked.filter(order => order.status !== 'done').length};
  });
  return {overallProgress, healthCounts, projects: rows, weeklyDone, milestones};
}
```

Build `weeklyDone` from completed orders' validated `updatedAt` week, not from invented historical percentages. Sort milestones by `dueDate`, then title, and cap at six.

- [ ] **Step 4: Run tests and commit**

```powershell
cd desktop-crm
node --test test/company-wallboard.test.js
cd ..
git add desktop-crm/src/company-wallboard.js desktop-crm/test/company-wallboard.test.js
git commit -m "feat: add TV project performance metrics"
```

Expected: PASS.

### Task 3: Today and week schedule projection

**Files:**
- Modify: `desktop-crm/src/company-wallboard.js`
- Test: `desktop-crm/test/company-wallboard.test.js`

- [ ] **Step 1: Write failing schedule tests**

Replace the old time/status-only expectations with tests for sanitized entries:

```js
assert.deepEqual(model.schedule.today[0], {
  date:'2026-09-20', time:'09:30', endTime:'10:30', title:'소방 점검', owner:'김현진', status:'예정'
});
assert.equal(model.schedule.week.length, 2);
assert.ok(!JSON.stringify(model.schedule).includes('010-'));
assert.ok(!JSON.stringify(model.schedule).includes('강원 원주시'));
```

Test cancelled exclusion, invalid dates, unknown times, chronological sorting, title/owner truncation, and empty schedules.

- [ ] **Step 2: Run the focused test and verify failure**

```powershell
cd desktop-crm
node --test test/company-wallboard.test.js
```

Expected: FAIL because the current schedule has only `available` and `entries`.

- [ ] **Step 3: Implement schedule allowlist**

Return:

```js
{
  available: true,
  today: [{date, time, endTime, title, owner, status}],
  week: [{date, time, endTime, title, owner, status}]
}
```

Use only `scheduledDate`, `startTime`, `endTime`, `title`, `owner`, and normalized status. Do not copy or spread the original record.

- [ ] **Step 4: Run tests and commit**

```powershell
cd desktop-crm
node --test test/company-wallboard.test.js
cd ..
git add desktop-crm/src/company-wallboard.js desktop-crm/test/company-wallboard.test.js
git commit -m "feat: publish sanitized CRM schedules to TV"
```

Expected: PASS.

### Task 4: Strict publication schema and publisher regression

**Files:**
- Modify: `desktop-crm/src/wallboard-publication-schema.js`
- Modify: `desktop-crm/src/wallboard-publisher.js`
- Modify: `desktop-crm/test/wallboard-publisher.test.js`
- Modify: `crm-ai-worker/test/wallboard-publication.test.js`

- [ ] **Step 1: Write failing schema tests**

Add one accepted complete snapshot and rejected snapshots for extra private keys, percentages above 100, invalid dates, more than 100 projects, more than 200 schedules, and unknown scene keys.

```js
assert.throws(() => validatePublication({...snapshot, model:{...snapshot.model, privateMemo:'x'}}), /INVALID_INPUT/);
assert.throws(() => validatePublication({...snapshot, playlist:[{key:'customer_private',enabled:true,seconds:30}]}), /INVALID_INPUT/);
```

- [ ] **Step 2: Run focused schema and publisher tests and verify failure**

```powershell
cd desktop-crm
node --test test/wallboard-publisher.test.js
cd ..\crm-ai-worker
node --test test/wallboard-publication.test.js
```

Expected: FAIL because the current exact-shape validator accepts only the old model.

- [ ] **Step 3: Extend the exact-shape validator**

Allow only these scene keys:

```js
const sceneKeys = [
  'roadmap','portfolio','weeklyTrend','health','milestones',
  'scheduleToday','scheduleWeek','people','issues','notice'
];
```

Validate every nested array and field with explicit maximums. Keep exact-key checking so private or future fields do not leak by accident.

- [ ] **Step 4: Verify publisher remains server-only**

Update the publisher fixture to return `{orders, projects, members}` from `loadWorkOrders`. Assert `loadStore` is never called and `serviceRecords` are read only through `dbRequest`.

- [ ] **Step 5: Run tests and commit**

```powershell
cd desktop-crm
node --test test/wallboard-publisher.test.js test/company-wallboard.test.js
cd ..\crm-ai-worker
node --test test/wallboard-publication.test.js
cd ..
git add desktop-crm/src/wallboard-publication-schema.js desktop-crm/src/wallboard-publisher.js desktop-crm/test/wallboard-publisher.test.js crm-ai-worker/test/wallboard-publication.test.js
git commit -m "feat: validate expanded TV publication"
```

Expected: PASS.

### Task 5: CRM preview scenes and playlist

**Files:**
- Modify: `desktop-crm/src/company-wallboard.js`
- Modify: `desktop-crm/src/company-wallboard.css`
- Modify: `desktop-crm/src/company-wallboard-theme.css`
- Test: `desktop-crm/test/company-wallboard.test.js`

- [ ] **Step 1: Write failing render tests**

Assert the roadmap scene contains lane, progress, health text, and right rail; schedule scenes include sanitized title/owner; all dynamic strings are escaped.

```js
const html = C.scene(model, 'roadmap', 0);
assert.match(html, /wb-roadmap-layout/);
assert.match(html, /전체 프로젝트 진행률/);
assert.match(html, /33%/);
assert.doesNotMatch(html, /<script>/);
```

- [ ] **Step 2: Run the focused test and verify failure**

```powershell
cd desktop-crm
node --test test/company-wallboard.test.js
```

Expected: FAIL because the scene keys are not rendered.

- [ ] **Step 3: Render ten scenes and Toss-style components**

Add scene renderers with these root classes:

```text
wb-roadmap-layout
wb-portfolio-bars
wb-weekly-chart
wb-health-grid
wb-milestone-list
wb-schedule-day
wb-schedule-week
```

Use shared CSS variables from `company-wallboard-theme.css`; keep fonts large, use labels in addition to colors, page people in groups of three and list rows in groups of six.

- [ ] **Step 4: Update default playlist**

Use the exact order and durations from the design document and retain local reorder/enable/duration controls.

- [ ] **Step 5: Run tests and commit**

```powershell
cd desktop-crm
node --test test/company-wallboard.test.js test/wallboard-admin-client.test.js
cd ..
git add desktop-crm/src/company-wallboard.js desktop-crm/src/company-wallboard.css desktop-crm/src/company-wallboard-theme.css desktop-crm/test/company-wallboard.test.js
git commit -m "feat: preview TV roadmap and schedule scenes"
```

Expected: PASS.

### Task 6: Public TV web scenes and zero-touch version

**Files:**
- Modify: `crm-ai-worker/src/wallboard-web-assets.js`
- Modify: `crm-ai-worker/test/wallboard-web.test.js`

- [ ] **Step 1: Write failing public-web tests**

Assert that the generated app contains all ten scene keys, the roadmap/right-rail CSS, schedule scene renderers, no third-party assets, `cache-control: no-store`, 15-second data polling, and 60-second version polling.

```js
assert.match(script, /scheduleToday/);
assert.match(script, /scheduleWeek/);
assert.match(styles, /roadmap-layout/);
assert.match(styles, /overall-progress/);
assert.match(script, /15000/);
assert.match(script, /60000/);
```

- [ ] **Step 2: Run the focused test and verify failure**

```powershell
cd crm-ai-worker
node --test test/wallboard-web.test.js
```

Expected: FAIL because the public web client supports only five old scenes.

- [ ] **Step 3: Implement public renderers and strict client validation**

Mirror the CRM preview using DOM nodes and `textContent`; do not interpolate server strings into `innerHTML`. Validate the expanded exact model before replacing the cached board. Catch per-scene rendering errors and advance to the next enabled scene.

- [ ] **Step 4: Increment the TV web version**

Change:

```js
export const WALLBOARD_WEB_VERSION='tv-web-2026-09-20-2';
```

This triggers one automatic cache-busting reload on already-paired TVs.

- [ ] **Step 5: Run tests and commit**

```powershell
cd crm-ai-worker
node --test test/wallboard-web.test.js test/wallboard-publication.test.js test/wallboard-pairing.test.js
cd ..
git add crm-ai-worker/src/wallboard-web-assets.js crm-ai-worker/test/wallboard-web.test.js
git commit -m "feat: show CRM roadmap and schedules on web TV"
```

Expected: PASS.

### Task 7: Full verification and deployment handoff

**Files:**
- Modify only if a test exposes a defect in the files listed above.

- [ ] **Step 1: Run the full desktop CRM suite**

```powershell
cd desktop-crm
npm test
```

Expected: all tests PASS.

- [ ] **Step 2: Run the full Worker suite**

```powershell
cd ..\crm-ai-worker
npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Run static checks**

```powershell
cd ..
git diff --check
git status --short
```

Expected: no whitespace errors; only the known untracked verification/release artifacts remain outside the feature changes.

- [ ] **Step 4: Test locally at TV sizes**

Open the local Worker preview at 1920×1080 and 1366×768. Verify every scene, manual previous/next, auto paging, empty states, cached-data fallback, and that no horizontal scroll or text overlap appears.

- [ ] **Step 5: Request code review**

Use the requesting-code-review workflow against the branch diff. Fix all correctness, privacy, and regression findings before deployment.

- [ ] **Step 6: Push and update the existing pull request**

```powershell
git push origin codex/free-web-tv-kiosk
```

Expected: PR 122 contains the new commits without force-push.

- [ ] **Step 7: Deploy only the Worker**

```powershell
cd crm-ai-worker
npm run deploy
```

Expected: Wrangler reports a successful new Worker version. Do not deploy Firebase Functions or Hosting.

- [ ] **Step 8: Verify production zero-touch behavior**

Confirm `/tv/version` returns `tv-web-2026-09-20-2`, the paired production TV reloads once, the ten-scene playlist appears, live project/schedule data is shown, and the page continues automatic rotation without manual Ctrl+F5.

