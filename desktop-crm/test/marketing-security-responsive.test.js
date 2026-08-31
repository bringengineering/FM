'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '..', 'src');
const UI = require(path.join(src, 'marketing-ui.js'));
const Core = require(path.join(src, 'marketing-core.js'));
const marketingCss = fs.readFileSync(path.join(src, 'marketing.css'), 'utf8');
const stylesCss = fs.readFileSync(path.join(src, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(src, 'app.js'), 'utf8');

const emptySnapshot = Core.buildSnapshot({ daily: [], facts: [] }, { period: 'thisMonth' }, new Date('2026-08-31T00:00:00Z'));

test('advertising writes follow the exact admin marketing sales viewer matrix', () => {
  assert.equal(UI.roleSubmissionPolicy({ accessRole: 'admin' }, 'marketingEntryForm').allowed, true);
  assert.equal(UI.roleSubmissionPolicy({ accessRole: 'member', marketingRole: 'marketing' }, 'marketingEntryForm').allowed, true);
  assert.deepEqual(UI.roleSubmissionPolicy({ accessRole: 'member', marketingRole: 'sales' }, 'marketingEntryForm'), { allowed: false, reason: 'raw-marketing-forbidden' });
  assert.deepEqual(UI.roleSubmissionPolicy({ accessRole: 'viewer', marketingRole: 'viewer' }, 'marketingEntryForm'), { allowed: false, reason: 'raw-marketing-forbidden' });
});

test('shared core role policy closes every fundamental and marketing role combination', () => {
  const cases = [
    [{ accessRole: 'admin', marketingRole: 'viewer' }, 'admin', true, true],
    [{ accessRole: 'member', marketingRole: 'marketing' }, 'marketing', true, true],
    [{ accessRole: 'member', marketingRole: 'sales' }, 'sales', true, false],
    [{ accessRole: 'member', marketingRole: 'viewer' }, 'viewer', false, false],
    [{ accessRole: 'viewer', marketingRole: 'marketing' }, 'viewer', false, false],
    [{ accessRole: 'unknown', marketingRole: 'marketing' }, 'viewer', false, false],
  ];
  for (const [user, role, attribution, spend] of cases) {
    assert.equal(Core.normalizeMarketingRole(user), role);
    assert.equal(Core.canEditAttribution(user), attribution);
    assert.equal(Core.canEditAdSpend(user), spend);
  }
  assert.equal(UI.crmEditPermissions({ accessRole: 'member', marketingRole: 'sales' }).attribution, true);
});

test('marketing visible text masks contacts credentials and private fields', () => {
  const unsafe = '010-1234-5678 owner@example.com idToken=abc refreshToken=def privateNote=문앞 비밀번호 1234';
  const safe = UI.sanitizeVisibleText(unsafe);
  assert.doesNotMatch(safe, /010-1234-5678|owner@example\.com|abc|def|문앞 비밀번호 1234/);
  assert.match(safe, /연락처 비공개|이메일 비공개|민감정보 비공개/);

  const rendered = UI.renderWorkspace({ view: 'marketingOverview', snapshot: emptySnapshot, filters: UI.defaultFilters(), error: unsafe });
  assert.doesNotMatch(rendered, /010-1234-5678|owner@example\.com|idToken|refreshToken|privateNote|문앞 비밀번호/);
  const copied = UI.weeklyReportText({ period: {}, metrics: {}, sourceUpdatedState: unsafe, channels: [], goodChannels: [], goodKeywords: [], costOnlyItems: [], lostReasons: [], nextWeekSuggestions: [], decisionItems: [] });
  assert.doesNotMatch(copied, /010-1234-5678|owner@example\.com|idToken|refreshToken|privateNote|문앞 비밀번호/);
});

test('marketing entries never expose operator ids audit receipt or contact fields', () => {
  const rendered = UI.renderMarketingInput({ active: [{ id: 'entry-1', date: '2026-08-30', channel: 'naver_blog', spend: 1, version: 1, createdByOperatorId: 'operator_secret', archivedByOperatorId: 'operator_archive', phone: '010-9999-8888', email: 'secret@example.com', privateNote: 'private', receipt: 'receipt-secret', audit: 'audit-secret' }] });
  assert.doesNotMatch(rendered, /operator_secret|operator_archive|010-9999-8888|secret@example\.com|private|receipt-secret|audit-secret/);
});

test('viewer facts partially mask phone-shaped visible values and sanitize all fields', () => {
  const rendered = UI.renderCustomerFacts([{ caseId: 'c1', customerName: '010-1234-5678', owner: 'owner@example.com', keyword: 'privateNote=door-code' }], { user: { accessRole: 'viewer', marketingRole: 'viewer' } });
  assert.match(rendered, /010-\*\*\*\*-5678/);
  assert.doesNotMatch(rendered, /010-1234-5678|owner@example\.com|door-code/);
});

test('sensitive owner keyword and campaign values never enter filter DOM attributes', () => {
  const options = UI.buildFilterOptions([{ owner: 'owner@example.com', keyword: '010-1234-5678', campaign: 'privateNote=secret' }]);
  const rendered = UI.renderWorkspace({ view: 'marketingOverview', snapshot: emptySnapshot, filters: UI.defaultFilters(), filterOptions: options });
  assert.doesNotMatch(rendered, /owner@example\.com|010-1234-5678|privateNote|secret/);
});

test('identity changes reset every filter and remove stale values before rendering', async () => {
  const controller = UI.createController({ core: Core, bridge: { projectFacts: store => store.facts || [] }, readRaw: async () => ({ daily: [{ date: '2026-08-30', channel: 'naver_blog', owner: '이전담당', campaign: '이전캠페인', keyword: '이전키워드' }] }) });
  await controller.load({ uid: 'A', accessRole: 'admin' }, {});
  controller.setFilter('owner', '이전담당'); controller.setFilter('campaign', '이전캠페인'); controller.setFilter('keyword', '이전키워드');
  controller.invalidate('identity-change', { uid: 'B', accessRole: 'admin' });
  assert.deepEqual(controller.filters, UI.defaultFilters());
  const html = UI.renderWorkspace({ view: 'marketingOverview', snapshot: null, filters: controller.filters, filterOptions: controller.state.filterOptions });
  assert.doesNotMatch(html, /이전담당|이전캠페인|이전키워드/);
});

test('marketing navigation alerts tables and duplicate dialog have accessible semantics', () => {
  const workspace = UI.renderWorkspace({ view: 'marketingChannels', snapshot: emptySnapshot, filters: UI.defaultFilters() });
  assert.match(workspace, /role="tablist"/);
  assert.match(workspace, /role="tab"[^>]+aria-selected="true"[^>]+tabindex="0"[^>]+aria-controls="marketingPanel-marketingChannels"/);
  assert.match(workspace, /role="tabpanel"[^>]+id="marketingPanel-marketingChannels"[^>]+aria-labelledby="marketingTab-marketingChannels"/);
  assert.match(workspace, /<caption>채널별 마케팅 성과<\/caption>/);
  assert.match(workspace, /<th scope="col">채널<\/th>/);

  const alerts = UI.renderAlerts([{ id: 'a', severity: 'warning', title: '확인', reason: '근거', targetId: 'case-1', targetType: 'case', evidence: {} }]);
  assert.match(alerts, /<button type="button" class="marketing-alert warning"/);
  assert.match(alerts, /aria-label="주의 알림: 확인"/);

  const dialog = UI.renderMarketingInput({ canWrite: true, review: { type: 'duplicate', message: '검토', existing: {}, proposed: {} }, active: [] });
  assert.match(dialog, /role="dialog"[^>]+aria-modal="true"[^>]+aria-labelledby="marketingReviewTitle"/);
  assert.match(dialog, /id="marketingReviewTitle"/);
  assert.match(dialog, /data-marketing-review-cancel[^>]+autofocus/);
  assert.match(app, /marketingReviewCancel[\s\S]*?event\.key === "Escape"/);
  assert.match(app, /marketingTab[\s\S]*?\["ArrowRight", "ArrowLeft", "Home", "End"\]/);
  assert.match(app, /pendingMarketingTabFocus[\s\S]*?querySelector[\s\S]*?\.focus\(\)/);
  assert.match(app, /marketingReviewDialog[\s\S]*?event\.key === "Tab"/);
  assert.match(app, /marketingReviewReturnFocus[\s\S]*?\.focus\(\)/);
});

test('weekly table has semantic headers and a horizontally scrollable wrapper', () => {
  const report = Core.buildWeeklyReport(emptySnapshot, [], new Date('2026-08-31T00:00:00Z'));
  const html = UI.renderWeekly(report);
  assert.match(html, /class="marketing-table-wrap"[^>]+tabindex="0"/);
  assert.match(html, /<caption>채널별 주간 성과<\/caption>/);
  assert.match(html, /<thead><tr><th scope="col">채널<\/th>/);
  const channelSnapshot = Core.buildSnapshot({ daily: [{ date: '2026-08-30', channel: 'naver_blog', spend: 1 }], facts: [] }, { period: 'thisMonth' }, new Date('2026-08-31T00:00:00Z'));
  assert.match(UI.renderWorkspace({ view: 'marketingChannels', snapshot: channelSnapshot, filters: UI.defaultFilters() }), /<tbody><tr><th scope="row">네이버 블로그<\/th>/);
});

test('runtime tab navigation and dialog focus trap move focus on live controls', () => {
  assert.equal(UI.nextMarketingTab('marketingOverview', 'ArrowRight'), 'marketingChannels');
  assert.equal(UI.nextMarketingTab('marketingOverview', 'ArrowLeft'), 'marketingWeekly');
  assert.equal(UI.nextMarketingTab('marketingFunnel', 'Home'), 'marketingOverview');
  const first = { focused: 0, focus() { this.focused += 1; } };
  const last = { focused: 0, focus() { this.focused += 1; } };
  const dialog = { querySelectorAll() { return [first, last]; } };
  let prevented = 0;
  assert.equal(UI.trapMarketingDialogFocus(dialog, { key: 'Tab', shiftKey: false, preventDefault() { prevented += 1; } }, last), true);
  assert.equal(first.focused, 1); assert.equal(prevented, 1);
  assert.equal(UI.trapMarketingDialogFocus(dialog, { key: 'Tab', shiftKey: true, preventDefault() { prevented += 1; } }, first), true);
  assert.equal(last.focused, 1);
});

test('entry controller invalidation clears raw state and ignores late user A reads', async () => {
  let resolveRead;
  const controller = UI.createEntryController({ read: () => new Promise(resolve => { resolveRead = resolve; }), save: async () => ({}), archive: async () => ({}) });
  controller.state.active = [{ id: 'A-secret' }]; controller.state.archived = [{ id: 'A-archive' }]; controller.state.review = { type: 'duplicate' };
  const late = controller.refresh();
  controller.invalidate();
  assert.deepEqual(controller.state.active, []); assert.deepEqual(controller.state.archived, []); assert.equal(controller.state.review, null);
  resolveRead({ daily: [{ id: 'late-A' }], archived: [{ id: 'late-archive' }] }); await late;
  assert.deepEqual(controller.state.active, []); assert.equal(controller.state.loaded, false);
});

test('duplicate comparison displays only allow-listed sanitized business fields', () => {
  const html = UI.renderMarketingInput({ canWrite: true, review: { type: 'duplicate', existing: { date: '2026-08-30', channel: 'naver_blog', spend: 10, createdByOperatorId: 'operator-secret', phone: '010-1234-5678', receipt: 'receipt-secret' }, proposed: { date: '2026-08-30', channel: 'naver_blog', spend: 20, privateNote: 'door-secret' }, openedVersion: 1 }, active: [] });
  assert.match(html, /기존 값|제안 값|2026-08-30|10원|20원/);
  assert.doesNotMatch(html, /operator-secret|010-1234-5678|receipt-secret|door-secret|createdByOperatorId|privateNote/);
});

test('marketing status is announced locally and unavailable never claims zero', () => {
  const loading = UI.renderWorkspace({ view: 'marketingOverview', snapshot: null, filters: UI.defaultFilters() });
  const unavailable = UI.renderWorkspace({ view: 'marketingOverview', snapshot: null, unavailable: true, filters: UI.defaultFilters() });
  assert.match(loading, /class="marketing-state" role="status" aria-live="polite"/);
  assert.match(unavailable, /class="marketing-state" role="status" aria-live="polite"/);
  assert.match(unavailable, /집계 데이터가 아직 준비되지 않았습니다/);
  assert.doesNotMatch(unavailable, /총 마케팅 비용|>0원</);
});

test('mobile and print CSS preserve required order sizing scroll and motion preferences', () => {
  assert.match(marketingCss, /@media \(max-width: 760px\)/);
  assert.match(marketingCss, /\.marketing-kpi-grid\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(marketingCss, /\.marketing-overview-layout\s*\{\s*display:\s*contents/);
  assert.match(marketingCss, /\.marketing-table-wrap\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(marketingCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(stylesCss, /@media\(max-width:760px\)[^{]*\{[\s\S]*?\.workspace-folder-grid\{grid-template-columns:1fr\}/);
  assert.match(marketingCss, /@media print[\s\S]*?\.marketing-weekly-report/);
  assert.match(app, /currentMarketingView === "marketingInput"[\s\S]*?record\.focus\(\)/);
});
