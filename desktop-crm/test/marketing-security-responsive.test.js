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

test('marketing navigation alerts tables and duplicate dialog have accessible semantics', () => {
  const workspace = UI.renderWorkspace({ view: 'marketingChannels', snapshot: emptySnapshot, filters: UI.defaultFilters() });
  assert.match(workspace, /role="tablist"/);
  assert.match(workspace, /role="tab"[^>]+aria-selected="true"[^>]+tabindex="0"/);
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
