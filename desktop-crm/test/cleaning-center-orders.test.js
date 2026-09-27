'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('cleaning center is one sidebar destination and does not duplicate CRM module navigation', () => {
  const html = read('desktop-crm/src/index.html');
  const start = html.indexOf('data-nav-folder="cleaning-center"');
  const end = html.indexOf('data-view="settings"', start);
  const folder = html.slice(start, end);
  assert.match(folder, /data-view="cleaningCenter"/u);
  for (const view of ['consultations', 'partnerQuotes', 'pipeline', 'customers', 'quotes', 'workOrders', 'workManagement', 'workReports', 'buildingAtlas', 'operationsIntelligence']) {
    assert.doesNotMatch(folder, new RegExp(`data-view="${view}"`), `${view} should be reached from its primary folder or the hub, not duplicated in the sidebar`);
  }
});

test('cleaning order IPC is allowlisted across policy, preload, and main process', () => {
  const policy = require('../src/mutation-policy');
  for (const [channel, type] of [
    ['crm:cleaning-orders-load', 'control'],
    ['crm:cleaning-order-load-by-id', 'control'],
    ['crm:cleaning-order-create', 'mutation'],
    ['crm:cleaning-order-transition', 'mutation'],
  ]) {
    assert.doesNotThrow(() => policy.assertRegistered(channel));
    assert.equal(policy.classification(channel), type);
  }
  const preload = read('desktop-crm/src/preload.js');
  const main = read('desktop-crm/src/main.js');
  for (const method of ['loadCleaningOrders', 'loadCleaningOrderById', 'createCleaningOrder', 'transitionCleaningOrder']) {
    assert.match(preload, new RegExp(`${method}:`));
  }
  for (const channel of ['crm:cleaning-orders-load', 'crm:cleaning-order-load-by-id', 'crm:cleaning-order-create', 'crm:cleaning-order-transition']) {
    assert.ok(main.includes(channel), channel);
  }
});

test('cleaning order IPC delegates only to the authenticated remote client and keeps preview isolated', async () => {
  const { createCleaningOrderIpcHandlers } = require('../src/cleaning-order-ipc');
  const calls = [];
  const remoteClient = {
    loadCleaningOrders: async cursor => { calls.push(['load', cursor]); return { orders: [], hasMore: false, nextCursor: null }; },
    loadCleaningOrderById: async id => { calls.push(['loadById', id]); return { order: { id } }; },
    createCleaningOrder: async input => { calls.push(['create', input]); return { order: { id: input.requestId } }; },
    transitionCleaningOrder: async input => { calls.push(['transition', input]); return { order: { id: input.orderId } }; },
  };
  const handlers = createCleaningOrderIpcHandlers({ getRemoteClient: () => remoteClient, isLocalTestMode: () => false });
  const cursor = { createdAt: '2026-09-26T00:00:00.000Z', id: 'order-cursor' };
  const createInput = { requestId: 'request-1' };
  const transitionInput = { orderId: 'order-1', expectedRevision: 1, nextStatus: 'reviewing' };

  assert.deepEqual(await handlers.load(cursor), { orders: [], hasMore: false, nextCursor: null });
  assert.deepEqual(await handlers.loadById('123e4567-e89b-42d3-a456-426614174000'), { order: { id: '123e4567-e89b-42d3-a456-426614174000' } });
  assert.deepEqual(await handlers.create(createInput), { order: { id: 'request-1' } });
  assert.deepEqual(await handlers.transition(transitionInput), { order: { id: 'order-1' } });
  assert.deepEqual(calls, [['load', cursor], ['loadById', '123e4567-e89b-42d3-a456-426614174000'], ['create', createInput], ['transition', transitionInput]]);

  const localHandlers = createCleaningOrderIpcHandlers({ getRemoteClient: () => remoteClient, isLocalTestMode: () => true });
  assert.deepEqual(await localHandlers.load(), { orders: [], hasMore: false, nextCursor: null, localOnly: true });
  assert.deepEqual(await localHandlers.loadById('123e4567-e89b-42d3-a456-426614174000'), { order: null, localOnly: true });
  assert.throws(() => localHandlers.create(createInput), /로컬 미리보기/u);
  assert.throws(() => localHandlers.transition(transitionInput), /로컬 미리보기/u);
  assert.throws(() => handlers.create([]), /주문 입력/u);
  assert.throws(() => handlers.transition(null), /상태 변경/u);
  assert.equal(calls.length, 4, 'invalid and local-only mutations must never call the remote client');
});

test('cleaning quote IPC exposes read and guarded draft/review commands without allowing local preview writes', async () => {
  const policy = require('../src/mutation-policy');
  const { createCleaningOrderIpcHandlers } = require('../src/cleaning-order-ipc');
  for (const [channel, type] of [
    ['crm:cleaning-quotes-load', 'control'],
    ['crm:cleaning-quote-create', 'mutation'],
    ['crm:cleaning-quote-review', 'mutation'],
  ]) {
    assert.doesNotThrow(() => policy.assertRegistered(channel));
    assert.equal(policy.classification(channel), type);
  }
  const calls = [];
  const remoteClient = {
    loadCleaningQuoteSet: async orderId => { calls.push(['load', orderId]); return { revisions: [] }; },
    createCleaningQuoteRevision: async input => { calls.push(['create', input]); return { revision: input.requestId }; },
    reviewCleaningQuote: async input => { calls.push(['review', input]); return { review: input.requestId }; },
  };
  const handlers = createCleaningOrderIpcHandlers({ getRemoteClient: () => remoteClient, isLocalTestMode: () => false });
  const draft = { orderId: '123e4567-e89b-42d3-a456-426614174000', requestId: '123e4567-e89b-42d3-a456-426614174001' };
  const review = { ...draft, quoteId: draft.requestId, decision: 'approve' };
  assert.deepEqual(await handlers.loadQuotes(draft.orderId), { revisions: [] });
  assert.deepEqual(await handlers.createQuoteRevision(draft), { revision: draft.requestId });
  assert.deepEqual(await handlers.reviewQuote(review), { review: draft.requestId });
  assert.deepEqual(calls, [['load', draft.orderId], ['create', draft], ['review', review]]);
  const localHandlers = createCleaningOrderIpcHandlers({ getRemoteClient: () => remoteClient, isLocalTestMode: () => true });
  assert.deepEqual(await localHandlers.loadQuotes(draft.orderId), { revisions: [], localOnly: true });
  assert.throws(() => localHandlers.createQuoteRevision(draft), /로컬 미리보기/u);
  assert.throws(() => localHandlers.reviewQuote(review), /로컬 미리보기/u);
  assert.throws(() => handlers.loadQuotes('../invalid'), /주문 ID/u);
  assert.equal(calls.length, 3);

  const preload = read('desktop-crm/src/preload.js');
  const main = read('desktop-crm/src/main.js');
  for (const method of ['loadCleaningQuoteSet', 'createCleaningQuoteRevision', 'reviewCleaningQuote']) assert.match(preload, new RegExp(`${method}:`));
  for (const channel of ['crm:cleaning-quotes-load', 'crm:cleaning-quote-create', 'crm:cleaning-quote-review']) assert.ok(main.includes(channel));
});

test('quote repository uses authenticated server API, validates order ID, and enforces administrator review', async () => {
  const { FirebaseRemoteClient } = require('../src/remote');
  const remote = new FirebaseRemoteClient({ Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '' });
  remote.session = { uid: 'quote-member', role: 'member', mustChangePassword: false };
  remote.cleaningOrdersEndpoint = 'https://example.test/cleaningOrdersApi';
  remote.ensureIdToken = async () => 'test-id-token';
  const sent = [];
  remote.fetch = async (url, options) => {
    sent.push({ url: new URL(url), options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: { revisions: [] } }) };
  };
  const orderId = '123e4567-e89b-42d3-a456-426614174000';
  await remote.loadCleaningQuoteSet(orderId);
  await remote.createCleaningQuoteRevision({ orderId, requestId: 'request-quote', expectedRevision: 0, quote: { items: [] } });
  assert.equal(sent[0].url.searchParams.get('quoteOrderId'), orderId);
  assert.equal(sent[0].options.headers.Authorization, 'Bearer test-id-token');
  assert.equal(JSON.parse(sent[1].options.body).action, 'quote-create');
  assert.equal(sent[1].options.headers.Authorization, 'Bearer test-id-token');
  await assert.rejects(remote.loadCleaningQuoteSet('../bad'), { code: 'VALIDATION_ERROR' });
  await assert.rejects(remote.reviewCleaningQuote({ orderId, requestId: 'request-review', decision: 'approve' }), { code: 'ACCESS_DENIED' });
  assert.equal(sent.length, 2, 'invalid and unauthorized operations must not reach the endpoint');
});

test('order transition explains the report evidence requirement returned by the server', async () => {
  const { FirebaseRemoteClient } = require('../src/remote');
  const remote = new FirebaseRemoteClient({ Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '' });
  remote.session = { uid: 'admin-01', role: 'admin', mustChangePassword: false };
  remote.cleaningOrdersEndpoint = 'https://example.test/cleaningOrdersApi';
  remote.ensureIdToken = async () => 'test-id-token';
  remote.fetch = async () => ({
    ok: false, status: 409,
    text: async () => JSON.stringify({ ok: false, error: { code: 'cleaning_order_completion_evidence_required' } }),
  });

  await assert.rejects(remote.transitionCleaningOrder({
    requestId: '123e4567-e89b-42d3-a456-426614174001',
    orderId: '123e4567-e89b-42d3-a456-426614174000',
    expectedRevision: 7,
    nextStatus: 'completed',
    note: '검수 완료',
  }), error => {
    assert.equal(error.code, 'CLEANING_ORDER_EVIDENCE_REQUIRED');
    assert.match(error.message, /결과보고서/u);
    assert.match(error.message, /전·후 사진/u);
    return true;
  });
});

  test('cleaning center gives eligible orders an order-linked quote action and renders the admin review state safely', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({ canWrite: true, canReviewQuotes: true, orders: [{
    id: '123e4567-e89b-42d3-a456-426614174000', title: '공용부 청소', status: 'approval_pending',
    quoteSummary: { latestRevision: 2, status: 'pending_review', totalAmount: 120000 },
  }] });
  assert.match(html, /data-action="manage-cleaning-quote" data-order-id="123e4567-e89b-42d3-a456-426614174000"/u);
  assert.match(html, /견적 2차 · 관리자 검토 대기/u);
  const review = ui.renderCleaningQuoteReview({ order: { id: '123e4567-e89b-42d3-a456-426614174000', title: '공용부 청소' }, quote: {
    id: '123e4567-e89b-42d3-a456-426614174001', revision: 2, status: 'pending_review', projectName: '<XSS>', totalAmount: 120000,
    items: [{ name: '공용부 청소', detail: '<script>x</script>', quantity: 1, unit: '식', unitPrice: 120000 }],
  }, canReview: true });
  assert.match(review, /견적 관리자 검수/u);
  assert.match(review, /견적 승인/u);
  assert.match(review, /수정 요청/u);
  assert.match(review, /&lt;XSS&gt;/u);
  assert.match(review, /&lt;script&gt;x&lt;\/script&gt;/u);
  assert.doesNotMatch(review, /<script>x<\/script>/u);
    assert.match(review, /고객에게 자동 발송되지 않으며/u);
  });

  test('cleaning order retains quote history after scheduling without offering a new revision', () => {
    const ui = require('../src/cleaning-center-ui');
    const html = ui.render({ canWrite: true, orders: [{
      id: '123e4567-e89b-42d3-a456-426614174000', title: '공용부 청소', status: 'scheduled',
      quoteSummary: { latestRevision: 1, status: 'admin_approved', totalAmount: 120000 },
    }] });
    assert.match(html, /data-action="manage-cleaning-quote" data-order-id="123e4567-e89b-42d3-a456-426614174000"/u);
    const review = ui.renderCleaningQuoteReview({
      order: { id: '123e4567-e89b-42d3-a456-426614174000', title: '공용부 청소', status: 'scheduled' },
      quote: { id: '123e4567-e89b-42d3-a456-426614174001', revision: 1, status: 'admin_approved', totalAmount: 120000 },
      canWrite: true,
      canCreateRevision: false,
    });
    assert.match(review, /CLEANING QUOTE · REVISION 1/u);
    assert.match(review, /관리자 승인/u);
    assert.doesNotMatch(review, /data-action="new-cleaning-quote-revision"/u);
  });

test('order-linked quote workflow loads revision history, reuses the CRM quote editor, and only creates a server draft', () => {
  const app = read('desktop-crm/src/app.js');
  const ui = read('desktop-crm/src/cleaning-center-ui.js');
  assert.match(app, /loadCleaningQuoteSet\(order\.id\)/u);
  assert.match(app, /data-action="save-cleaning-order-quote"/u);
  assert.match(app, /createCleaningQuoteRevision\(/u);
  assert.match(app, /reviewCleaningQuote\(/u);
  assert.match(app, /quoteSet\??\.latestRevision/u);
  assert.match(ui, /관리자 승인은 내부 검수만 완료합니다/u);
  assert.doesNotMatch(app, /sendCustomerNotice\([^)]*cleaningQuote/u);
});

test('order transition confirmation uses the CRM modal with a required bounded reason', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.renderTransitionConfirmation({
    orderId: 'order-1',
    orderTitle: '<공용부 청소>',
    currentStatus: '검토 중',
    nextStatus: '견적 대기',
    expectedRevision: 3,
  });

  assert.match(html, /청소 요청 단계 변경/u);
  assert.match(html, /&lt;공용부 청소&gt;/u);
  assert.match(html, /검토 중<\/span><b aria-hidden="true">→<\/b><strong>견적 대기/u);
  assert.match(html, /id="cleaningOrderTransitionForm"/u);
  assert.match(html, /name="note"[^>]*required/u);
  assert.match(html, /name="note"[^>]*maxlength="500"/u);
  assert.match(html, /data-action="close-modal"/u);
  assert.match(html, /type="submit"[^>]*>변경 확인/u);
  assert.match(html, /data-order-id="order-1"/u);
  assert.match(html, /data-expected-revision="3"/u);
});

test('cleaning order transition action opens its modal and never invokes native prompt', () => {
  const app = read('desktop-crm/src/app.js');
  const start = app.indexOf('const advanceCleaningOrder = event.target.closest');
  const end = app.indexOf("if (event.target.closest('[data-strategy-refresh]'))", start);
  const handler = app.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(handler, /renderTransitionConfirmation/u);
  assert.match(handler, /cleaningOrderTransitionForm/u);
  assert.doesNotMatch(handler, /window\.prompt/u);
});

test('cleaning order transition submit preserves revision and request id and only refreshes after success', () => {
  const app = read('desktop-crm/src/app.js');
  const start = app.indexOf('if (form.id === "cleaningOrderTransitionForm")');
  const end = app.indexOf('if (form.id === "billingReturnForm")', start);
  const handler = app.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(handler, /form\.reportValidity\(\)/u);
  assert.match(handler, /expectedRevision\s*=\s*Number\(form\.dataset\.expectedRevision\)/u);
  assert.match(handler, /requestId\s*=\s*String\(form\.dataset\.requestId\s*\|\|\s*""\)/u);
  assert.match(handler, /api\.transitionCleaningOrder\(\{\s*requestId,\s*orderId,\s*expectedRevision,\s*nextStatus,\s*note\s*\}\)/u);
  assert.match(handler, /await api\.transitionCleaningOrder[\s\S]*?closeModal\(\)[\s\S]*?await loadCleaningOrders\(\)/u);
  assert.match(handler, /catch \(error\)[\s\S]*?showToast\(error\?\.message/u);
  assert.match(handler, /finally[\s\S]*?cleaningOrderState\.busy\s*=\s*false/u);
  assert.doesNotMatch(handler, /window\.prompt/u);
});

test('cleaning order transition modal cancellation only uses the shared close action', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.renderTransitionConfirmation({ orderId: 'cancel-order', expectedRevision: 1 });
  const app = read('desktop-crm/src/app.js');
  const closeHandlerStart = app.indexOf('if (action === "close-modal")');
  const closeHandlerEnd = app.indexOf('else if (action ===', closeHandlerStart + 10);
  const closeHandler = app.slice(closeHandlerStart, closeHandlerEnd);

  assert.match(html, /<button type="button" class="secondary-button" data-action="close-modal">취소<\/button>/u);
  assert.ok(closeHandlerStart >= 0 && closeHandlerEnd > closeHandlerStart);
  assert.match(closeHandler, /closeModal\(\)/u);
  assert.doesNotMatch(closeHandler, /transitionCleaningOrder/u);
});

test('cleaning order intake requires an explicit service type instead of defaulting every request to move-in cleaning', () => {
  const app = read('desktop-crm/src/app.js');
  const start = app.indexOf('function openCleaningOrderForm()');
  const end = app.indexOf('function applyWorkspaceChrome(', start);
  const form = app.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(form, /<select name="serviceType" required><option value="">서비스 유형 선택<\/option><option value="move_in_cleaning"/u);
});

test('CRM keeps server TV-projection freshness feedback visible after order writes', () => {
  const remote = read('desktop-crm/src/remote.js');
  const app = read('desktop-crm/src/app.js');
  assert.match(remote, /wallboardProjectionUpdated/u);
  assert.match(app, /wallboardProjectionUpdated\s*===\s*false/u);
  assert.match(app, /TV 운영보드 요약 갱신은 지연 중/u);
});

test('cleaning orders are server-only and TV reads only aggregate projection', () => {
  const rules = JSON.parse(read('database.rules.json')).rules.crmCompany;
  assert.equal(rules.cleaningOrders['.read'], false);
  assert.equal(rules.cleaningOrders['.write'], false);
  const projection = rules.wallboard.cleaningOperations;
  assert.match(projection['.read'], /wallboardReaders/u);
  assert.equal(projection['.write'], false);
});

test('cleaning center renders a connected order queue and explicit next-step action', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({
    orders: [{ id: 'order-1', title: '공용부 청소', customerName: '고객 A', buildingName: '건물 A', status: 'scheduled', statusLabel: '일정 확정', desiredDate: '2026-09-30', nextStatus: 'in_progress', nextStatusLabel: '작업 중' }],
  });
  assert.match(html, /ORDER QUEUE/u);
  assert.match(html, /공용부 청소/u);
  assert.match(html, /data-action="advance-cleaning-order"/u);
  assert.match(html, /data-action="new-cleaning-order"/u);
});

test('cleaning center dashboard derives stage KPIs only from loaded canonical cleaning orders', () => {
  const ui = require('../src/cleaning-center-ui');
  const orders = [
    { id: 'o1', status: 'received', desiredDate: '2026-09-26' },
    { id: 'o2', status: 'reviewing', desiredDate: '2026-09-27' },
    { id: 'o3', status: 'quote_pending' },
    { id: 'o4', status: 'approval_pending' },
    { id: 'o5', status: 'scheduled' },
    { id: 'o6', status: 'in_progress' },
    { id: 'o7', status: 'review_pending' },
    { id: 'o8', status: 'revision_requested' },
    { id: 'o9', status: 'completed', desiredDate: '2026-09-01' },
    { id: 'o10', status: 'cancelled', desiredDate: '2026-09-01' },
  ];
  const result = ui.summarizeOrderQueue({ orders, ordersLoaded: true, ordersHasMore: true, asOf: '2026-09-27' });
  assert.deepEqual(result.counts, { intake: 2, estimateApproval: 2, scheduledWork: 2, review: 1, revision: 1, completed: 1, overdue: 1 });
  assert.equal(result.overdue, 1);
  assert.equal(result.total, 10);
  assert.equal(result.scopeLabel, '최근 불러온 10건 · 전체 주문 중 일부');
  const refreshed = ui.summarizeOrderQueue({ orders, ordersLoaded: true, ordersHasMore: true, ordersUpdatedAt: Date.parse('2026-09-27T03:04:00.000Z'), asOf: '2026-09-27' });
  assert.match(refreshed.updatedAtLabel, /자료 갱신/u);

  const loading = ui.summarizeOrderQueue({ orders: [], ordersLoading: true, ordersLoaded: false });
  const failed = ui.summarizeOrderQueue({ orders: [], ordersError: 'network', ordersLoaded: false });
  const empty = ui.summarizeOrderQueue({ orders: [], ordersLoaded: true, ordersHasMore: false });
  assert.equal(loading.state, 'loading');
  assert.equal(failed.state, 'error');
  assert.equal(empty.counts.intake, 0);
  assert.equal(empty.overdue, 0);

  const pending = ui.render({ ordersLoaded: false, ordersLoading: true });
  const loaded = ui.render({ orders, ordersLoaded: true, ordersHasMore: true, ordersUpdatedAt: Date.parse('2026-09-27T03:04:00.000Z'), asOf: '2026-09-27' });
  const error = ui.render({ orders, ordersLoaded: true, ordersError: 'network', asOf: '2026-09-27' });
  assert.match(pending, /집계 대기/u);
  assert.match(loaded, /최근 불러온 10건 · 전체 주문 중 일부/u);
  assert.match(loaded, /자료 갱신/u);
  assert.match(loaded, /기한 초과<\/span><strong>1<small>건/u);
  assert.match(error, /주문 현황 조회 실패/u);
  assert.doesNotMatch(error, /기한 초과<\/span><strong>1<small>건/u);
  assert.match(loaded, /data-cleaning-status-preset="quote_pending,approval_pending"/u);
  assert.match(loaded, /data-cleaning-status-preset="scheduled,in_progress"/u);
  assert.match(loaded, /data-cleaning-status-preset="review_pending"/u);
  assert.match(loaded, /data-cleaning-status-preset="revision_requested"/u);
  assert.match(loaded, /data-cleaning-status-preset="__overdue"/u);
  assert.equal(ui.matchesOrderFilter({ status: 'approval_pending' }, '', 'quote_pending,approval_pending'), true);
  assert.equal(ui.matchesOrderFilter({ status: 'completed' }, '', 'quote_pending,approval_pending'), false);
  assert.equal(ui.matchesOrderFilter({ status: 'in_progress', desiredDate: '2026-09-26' }, '', '__overdue', '2026-09-27'), true);
  assert.equal(ui.matchesOrderFilter({ status: 'completed', desiredDate: '2026-09-26' }, '', '__overdue', '2026-09-27'), false);
  const app = read('desktop-crm/src/app.js');
  assert.match(app, /ordersLoaded: cleaningOrderState\.loaded/u);
  assert.match(app, /data-cleaning-status-preset/u);
  assert.match(app, /cleaningOrderState\.statusFilter = cleaningStatusPreset\.dataset\.cleaningStatusPreset/u);
});

test('cleaning center shows the linked work-order assignee and due date so dispatch is visible', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({ orders: [{
    id: 'order-assignment-1', title: '계단 청소', status: 'scheduled',
    relatedWorkOrders: [{ id: 'work-1', title: '계단 청소 현장작업', progress: 0, status: 'assigned', assigneeName: '김현진', dueDate: '2026-09-28' }],
  }] });
  assert.match(html, /담당 김현진/u);
  assert.match(html, /기한 2026-09-28/u);
  const app = read('desktop-crm/src/app.js');
  assert.match(app, /assigneeName: item\.assigneeName \|\| "담당자 미배정"/u);
  assert.match(app, /dueDate: item\.dueDate \|\| ""/u);
});

test('cleaning order queue supports status and customer/building text filters without matching unrelated fields', () => {
  const ui = require('../src/cleaning-center-ui');
  const order = { title: '퇴실 청소', customerName: '홍길동', buildingName: '햇빛빌라', description: '욕실과 주방', status: 'scheduled' };
  assert.equal(ui.matchesOrderFilter(order, '햇빛', 'scheduled'), true);
  assert.equal(ui.matchesOrderFilter(order, '홍길동', 'all'), true);
  assert.equal(ui.matchesOrderFilter(order, '욕실', 'all'), true);
  assert.equal(ui.matchesOrderFilter(order, '존재하지 않음', 'all'), false);
  assert.equal(ui.matchesOrderFilter(order, '햇빛', 'received'), false);

  const html = ui.render({ orders: [{ id: 'order-filter-1', ...order }] });
  const app = read('desktop-crm/src/app.js');
  assert.match(html, /data-cleaning-order-search/u);
  assert.match(html, /data-cleaning-order-status/u);
  assert.match(html, /data-cleaning-filter-count/u);
  assert.match(html, /data-cleaning-no-match/u);
  assert.match(app, /matchesOrderFilter\(\{[\s\S]*?title: row\.querySelector\("strong"\)/u);
  assert.match(app, /cleaningOrderState\.search = String\(event\.target\.value \|\| ""\)/u);
  assert.match(app, /cleaningOrderState\.statusFilter = event\.target\.value \|\| "all"/u);
});

test('cleaning order queue exposes a safe older-orders action only when the server has another page', () => {
  const ui = require('../src/cleaning-center-ui');
  const available = ui.render({ orders: [{ id: 'order-page-1', title: '청소 요청' }], ordersHasMore: true });
  const complete = ui.render({ orders: [{ id: 'order-page-1', title: '청소 요청' }], ordersHasMore: false });
  assert.match(available, /data-action="load-more-cleaning-orders"/u);
  assert.match(available, /이전 요청 더 보기/u);
  assert.doesNotMatch(complete, /data-action="load-more-cleaning-orders"/u);
});

test('Firebase order-list bridge sends only the validated cursor to the authenticated server API', async () => {
  const { FirebaseRemoteClient } = require('../src/remote');
  const remote = new FirebaseRemoteClient({ Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '' });
  remote.session = { uid: 'page-member', role: 'member', mustChangePassword: false };
  remote.cleaningOrdersEndpoint = 'https://example.test/cleaningOrdersApi';
  remote.ensureIdToken = async () => 'test-id-token';
  let sent;
  remote.fetch = async (url, options) => {
    sent = { url: new URL(url), options };
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: { orders: [], hasMore: false, nextCursor: null } }) };
  };
  await remote.loadCleaningOrders({ createdAt: '2026-09-26T00:00:00.000Z', id: 'page_order_000005' });
  assert.equal(sent.url.searchParams.get('beforeCreatedAt'), '2026-09-26T00:00:00.000Z');
  assert.equal(sent.url.searchParams.get('beforeId'), 'page_order_000005');
  assert.equal(sent.options.headers.Authorization, 'Bearer test-id-token');
  await assert.rejects(remote.loadCleaningOrders({ createdAt: 'not-a-time', id: 'bad' }), { code: 'VALIDATION_ERROR' });
});

test('Firebase order detail bridge loads an exact order id instead of depending on the first list page', async () => {
  const { FirebaseRemoteClient } = require('../src/remote');
  const remote = new FirebaseRemoteClient({ Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '' });
  remote.session = { uid: 'page-member', role: 'member', mustChangePassword: false };
  remote.cleaningOrdersEndpoint = 'https://example.test/cleaningOrdersApi';
  remote.ensureIdToken = async () => 'test-id-token';
  let sent;
  remote.fetch = async url => {
    sent = new URL(url);
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: { order: { id: '7c2ac2d0-9a09-42f3-b8f8-7237562fc501' } } }) };
  };
  await remote.loadCleaningOrderById('7c2ac2d0-9a09-42f3-b8f8-7237562fc501');
  assert.equal(sent.searchParams.get('orderId'), '7c2ac2d0-9a09-42f3-b8f8-7237562fc501');
  await assert.rejects(remote.loadCleaningOrderById('../bad'), { code: 'VALIDATION_ERROR' });
});

test('linked work reports resolve an order missing from the current list page before deciding edit access', () => {
  const app = read('desktop-crm/src/app.js');
  assert.match(app, /async function resolveCleaningOrderById\(/u);
  assert.match(app, /await resolveCleaningOrderById\(found\.cleaningOrderId\)/u);
});

test('cleaning center lets an admin start a work order from the canonical cleaning request', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({
    canCreateWorkOrders: true,
    orders: [{ id: 'order-1', title: '공용부 청소', buildingId: 'building-1', desiredDate: '2026-09-30', status: 'scheduled' }],
  });
  const app = read('desktop-crm/src/app.js');

  assert.match(html, /data-action="create-cleaning-work-order" data-order-id="order-1"/u);
  assert.match(app, /create-cleaning-work-order/u);
  assert.match(app, /cleaningOrderId: order\.id/u);
  assert.match(app, /buildingId: String\(order\.buildingId \|\| ""\)/u);
  assert.match(app, /\["approval_pending", "scheduled", "in_progress", "revision_requested"\]\.includes\(order\.status\)/u);
  const approvalPending = ui.render({ canCreateWorkOrders: true, orders: [{ id: 'order-pending', status: 'approval_pending' }] });
  const viewer = ui.render({ canCreateWorkOrders: false, orders: [{ id: 'order-1', status: 'scheduled' }] });
  const beforeSchedule = ui.render({ canCreateWorkOrders: true, orders: [{ id: 'order-1', status: 'reviewing' }] });
  const alreadyAssigned = ui.render({ canCreateWorkOrders: true, orders: [{ id: 'order-1', status: 'in_progress', relatedWorkOrders: [{ id: 'work-1', status: 'doing' }] }] });
  assert.doesNotMatch(viewer, /data-action="create-cleaning-work-order"/u);
  assert.match(approvalPending, /data-action="create-cleaning-work-order" data-order-id="order-pending"/u);
  assert.doesNotMatch(beforeSchedule, /data-action="create-cleaning-work-order"/u);
  assert.doesNotMatch(alreadyAssigned, /data-action="create-cleaning-work-order"/u);
});

test('cleaning center offers a linked field report only while work is active and the user can write reports', () => {
  const ui = require('../src/cleaning-center-ui');
  const active = ui.render({ canCreateWorkReports: true, orders: [{ id: 'order-report', status: 'in_progress' }] });
  const revision = ui.render({ canCreateWorkReports: true, orders: [{ id: 'order-revision', status: 'revision_requested' }] });
  const viewer = ui.render({ canCreateWorkReports: false, orders: [{ id: 'order-report', status: 'in_progress' }] });
  const notStarted = ui.render({ canCreateWorkReports: true, orders: [{ id: 'order-report', status: 'scheduled' }] });
  const app = read('desktop-crm/src/app.js');

  assert.match(active, /data-action="create-cleaning-work-report" data-order-id="order-report"/u);
  assert.match(revision, /data-action="create-cleaning-work-report" data-order-id="order-revision"/u);
  assert.doesNotMatch(viewer, /data-action="create-cleaning-work-report"/u);
  assert.doesNotMatch(notStarted, /data-action="create-cleaning-work-report"/u);
  assert.match(app, /draftForCleaningOrder\(order, building/u);
  assert.match(app, /미저장 결과보고 초안이 있습니다/u);
  assert.match(app, /reportState\.canWork/u);
});

test('cleaning center disables order mutations for read-only CRM users', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({ canWrite: false, orders: [{
    id: 'order-view-only', title: '공용부 청소', status: 'scheduled',
    nextStatus: 'in_progress', nextStatusLabel: '작업 중',
  }] });

  assert.match(html, /data-action="new-cleaning-order"[^>]*disabled/u);
  assert.match(html, /data-action="advance-cleaning-order"[^>]*disabled/u);
  assert.match(html, /조회 전용/u);
});

test('cleaning center turns server error codes into actionable Korean guidance', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({ ordersError: 'cleaning_order_revision_conflict' });

  assert.match(html, /다른 사용자가 주문을 변경했습니다/u);
  assert.match(html, /새로고침/u);
  assert.doesNotMatch(html, /cleaning_order_revision_conflict/u);
});

test('completion evidence errors tell the reviewer to attach openable Drive photos', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({ ordersError: 'cleaning_order_completion_evidence_required' });
  assert.match(html, /결과보고서.*체크리스트.*Google Drive/u);
  assert.doesNotMatch(html, /cleaning_order_completion_evidence_required/u);
});

test('cleaning center distinguishes loading, empty, and escaped error states', () => {
  const ui = require('../src/cleaning-center-ui');
  const loading = ui.render({ ordersLoading: true });
  const empty = ui.render({ orders: [] });
  const failed = ui.render({ ordersError: '<img src=x onerror=alert(1)>' });

  assert.match(loading, /주문을 불러오는 중입니다/u);
  assert.doesNotMatch(loading, /등록된 주문이 없습니다/u);
  assert.match(empty, /등록된 주문이 없습니다/u);
  assert.match(failed, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.doesNotMatch(failed, /<img src=x/u);
});

test('Electron local smoke verifies cleaning-order bridge without using company data', () => {
  const main = read('desktop-crm/src/main.js');
  const smokeStart = main.indexOf('if (process.env.BRING_CRM_SMOKE === "1")');
  const screenshotStart = main.indexOf('if (process.env.BRING_CRM_SCREENSHOT)', smokeStart);
  const smoke = main.slice(smokeStart, screenshotStart);

  assert.match(smoke, /loadCleaningOrders\(\)/u);
  assert.match(smoke, /if \(!result\.localOnly \|\| !Array\.isArray\(result\.orders\) \|\| result\.orders\.length !== 0\)/u);
  assert.match(smoke, /return \{ localOnly: result\.localOnly, count: result\.orders\.length \}/u);
  assert.match(smoke, /workspace-enter-folder="cleaning-center"/u);
  assert.match(smoke, /data-action="new-cleaning-order"/u);
  assert.match(smoke, /cleaningOrderForm/u);
  assert.match(smoke, /cleaning_smoke_customer/u);
  assert.match(smoke, /buildingSelect\.options\.length\s*===\s*2/u);
  assert.match(smoke, /linkedBuildingOnly/u);
  assert.match(smoke, /cleaningStageCardCount === 7/u);
  assert.match(smoke, /확인된 전체 주문 0건/u);
});

test('isolated CRM screenshot action opens the Cleaning Center and records seven KPI cards', () => {
  const main = read('desktop-crm/src/main.js');
  assert.match(main, /cleaning-center-summary-preview/u);
  assert.match(main, /cleaningStageCardCount === 7/u);
  assert.match(main, /emptyQueueScopeVisible/u);
  assert.match(main, /"cleaning-center-summary-preview"/u);
});

test('order rows show linked CRM work and result evidence by reference', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({ orders: [{
    id: 'order-1', title: '공용부 청소', status: 'in_progress',
    relatedWorkOrders: [{ id: 'work-1', title: '계단 청소 지시', progress: 60 }],
    relatedReports: [{ id: 'report-1', title: '현장 결과보고', workDate: '2026-09-25', photoCount: 4 }],
  }] });
  assert.match(html, /계단 청소 지시/u);
  assert.match(html, /data-action="open-cleaning-work-order" data-record-id="work-1"/u);
  assert.match(html, /현장 결과보고/u);
  assert.match(html, /data-action="open-cleaning-report" data-record-id="report-1"/u);
  assert.match(html, /증빙 사진 4장/u);
});

test('cleaning order detail modal consolidates linked data without exposing actor identifiers', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.renderOrderDetails({
    id: 'order-detail-1', title: '공용부 청소', status: 'review_pending', statusLabel: '검수 대기',
    serviceType: 'common_cleaning', customerName: '고객 A', buildingName: '햇빛빌라',
    description: '<script>alert(1)</script>', desiredDate: '2026-09-28', createdAt: '2026-09-20', updatedAt: '2026-09-25', revision: 2,
    quoteSummary: { latestRevision: 1, status: 'admin_approved', totalAmount: 55000 },
    relatedWorkOrders: [{ id: 'work-9', title: '계단 작업', status: 'done', progress: 100, assigneeName: '현진', dueDate: '2026-09-25' }],
    relatedReports: [{ id: 'report-9', title: '결과 보고서', workDate: '2026-09-25', photoCount: 2, checklistSummary: { done: 1, partial: 0, skipped: 0, progress: 100, items: [{ label: '계단', statusLabel: '완료', beforeCount: 1, afterCount: 1, note: '<확인>' }] } }],
    history: [{ status: 'review_pending', changedAt: '2026-09-25', changedByUid: 'private-user-uid', note: '증빙 제출' }],
  });
  for (const section of ['주문 상세', '접수 정보', '견적·승인', '일정·배정', '현장 결과·증빙', '상태 변경 이력']) assert.match(html, new RegExp(section, 'u'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<script>|private-user-uid/u);
  assert.match(html, /data-action="open-cleaning-work-order" data-record-id="work-9"/u);
  assert.match(html, /data-action="open-cleaning-report" data-record-id="report-9"/u);
  assert.match(html, /진행 체크리스트/u);
  assert.match(html, /계단 · 완료/u);
  assert.match(html, /작업 전 1장 · 작업 후 1장/u);
  assert.match(html, /&lt;확인&gt;/u);
});

test('cleaning order row exposes a detail action wired to a read-only CRM modal', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({ orders: [{ id: 'order-modal-1', title: '계단 청소', status: 'received' }] });
  assert.match(html, /data-action="view-cleaning-order-details" data-order-id="order-modal-1"/u);
  const app = read('desktop-crm/src/app.js');
  const start = app.indexOf("data-action=\"view-cleaning-order-details\"");
  assert.notEqual(start, -1);
  const handler = app.slice(start - 300, start + 1700);
  assert.match(handler, /renderOrderDetails\(/u);
  assert.match(handler, /modalContent\.innerHTML/u);
  assert.doesNotMatch(handler, /api\.(?:save|update|transition|create|delete)/u);
});

test('report edit access follows the linked cleaning-order review and revision lifecycle', () => {
  const ui = require('../src/cleaning-center-ui');
  const report = { cleaningOrderId: 'order-1' };
  assert.equal(ui.cleaningReportEditAccess(report, { id: 'order-1', status: 'in_progress' }).editable, true);
  assert.equal(ui.cleaningReportEditAccess(report, { id: 'order-1', status: 'revision_requested' }).editable, true);
  assert.match(ui.cleaningReportEditAccess(report, { id: 'order-1', status: 'review_pending' }).reason, /검수 대기/u);
  assert.match(ui.cleaningReportEditAccess(report, { id: 'order-1', status: 'completed' }).reason, /완료/u);
  assert.equal(ui.cleaningReportEditAccess(report, null).editable, false);
  assert.equal(ui.cleaningReportEditAccess({ cleaningOrderId: '' }, null).editable, true);
});

test('locked work report viewer keeps evidence links but exposes no edit controls', () => {
  const app = read('desktop-crm/src/app.js');
  const viewer = app.slice(app.indexOf('function renderReadOnlyWorkReport'), app.indexOf('function reportEditor'));
  assert.match(viewer, /data-report-open-photo=/u);
  assert.match(viewer, /작업 전/u);
  assert.match(viewer, /작업 후/u);
  assert.doesNotMatch(viewer, /data-report-form|data-report-status|data-report-note|data-report-add-photo|data-report-drop-photo/u);
});

test('work report editor labels photos with missing or non-Drive links instead of dead links', () => {
  const app = read('desktop-crm/src/app.js');
  const start = app.indexOf('function reportEditor(');
  const end = app.indexOf('function ', start + 20);
  const editor = app.slice(start, end);
  assert.match(editor, /photo\.webViewLink\s*\?/u);
  assert.match(editor, /Drive 링크 확인/u);
});

test('order details expose canonical revision and status history without actor identifiers', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({ orders: [{
    id: 'order-detail-1', title: '공용부 청소', status: 'reviewing', revision: 2,
    createdAt: '2026-09-25T01:00:00.000Z', updatedAt: '2026-09-25T02:00:00.000Z',
    history: [
      { status: 'received', changedAt: '2026-09-25T01:00:00.000Z', changedByUid: 'private-user-1', note: '주문 접수' },
      { status: 'reviewing', changedAt: '2026-09-25T02:00:00.000Z', changedByUid: 'private-user-2', note: '<script>검토</script> 시작' },
    ],
  }] });
  assert.match(html, /data-cleaning-order-detail="order-detail-1"/u);
  assert.match(html, /주문 변경 이력/u);
  assert.match(html, /2차 수정/u);
  assert.match(html, /접수/u);
  assert.match(html, /검토 중/u);
  assert.match(html, /&lt;script&gt;검토&lt;\/script&gt; 시작/u);
  assert.doesNotMatch(html, /private-user-[12]/u);
  assert.doesNotMatch(html, /<script>검토<\/script>/u);
});

test('order rows expose service type and safely escaped request details on demand', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({ orders: [{
    id: 'order-2', title: '퇴실 청소', serviceType: 'move_out_cleaning',
    description: '<script>do bad</script> 주방·욕실 중심으로 요청', status: 'received',
  }] });
  assert.match(html, /퇴실 청소/u);
  assert.match(html, /<details class="cleaning-order-request">/u);
  assert.match(html, /&lt;script&gt;do bad&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<script>do bad<\/script>/u);
});

test('order rows do not render an empty detail expander for legacy records', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({ orders: [{ id: 'legacy-order', title: '기존 요청' }] });
  assert.doesNotMatch(html, /cleaning-order-request/u);
});

test('work reports expose an optional order link restricted to the selected building and rules verify that relationship', () => {
  const app = read('desktop-crm/src/app.js');
  const reportRules = JSON.parse(read('database.rules.json')).rules.crmCompany.workReports.$reportId;
  assert.match(app, /name="cleaningOrderId" data-report-cleaning-order/u);
  assert.match(app, /filter\(item => String\(item\.buildingId \|\| ""\) === draft\.buildingId\)/u);
  assert.match(app, /cleaningOrderId: String\(raw\.cleaningOrderId \|\| ""\)/u);
  assert.match(reportRules.cleaningOrderId['.validate'], /cleaningOrders/u);
  assert.match(reportRules.cleaningOrderId['.validate'], /newData\.parent\(\)\.child\('buildingId'\)/u);
  assert.equal(reportRules.$other['.validate'], false);
});

test('customer and building CRM details show canonical cleaning-order history links', () => {
  const app = read('desktop-crm/src/app.js');
  assert.match(app, /function cleaningOrderHistoryMarkup\(orders\)/u);
  assert.match(app, /data-action="open-cleaning-order" data-order-id=/u);
  assert.match(app, /클리닝 주문 이력/u);
  assert.match(app, /<b>클리닝 주문<\/b>/u);
  assert.match(app, /order\.customerId === customer\.id \|\| buildingIds\.has\(order\.buildingId\)/u);
  assert.match(app, /const cleaningHistory=\{title:"클리닝 주문",lines:cleaningOrders\.map/u);
});

test('work order and cleaning order building IDs stay aligned at the UI and database rule boundary', () => {
  const app = read('desktop-crm/src/app.js');
  const orderRule = JSON.parse(read('database.rules.json')).rules.crmCompany.workOrders.$orderId;
  assert.match(app, /const linkedOrder = cleaningOrderState\.orders\.find\(item => item\.id === String\(raw\.cleaningOrderId \|\| ""\)\)/u);
  assert.match(app, /buildingId: linkedOrder \? String\(linkedOrder\.buildingId \|\| ""\) : previous\.buildingId/u);
  assert.match(orderRule.cleaningOrderId['.validate'], /newData\.parent\(\)\.child\('buildingId'\)/u);
});

test('order form limits building choices to the selected customer and keeps a retry id stable', () => {
  const app = read('desktop-crm/src/app.js');
  assert.match(app, /customerBuildings\(customerById\(customerSelect\.value\)\)/u);
  assert.match(app, /buildingSelect\.replaceChildren/u);
  assert.match(app, /form\.dataset\.requestId\s*\|\|\s*\(form\.dataset\.requestId\s*=\s*crypto\.randomUUID\(\)\)/u);
});
