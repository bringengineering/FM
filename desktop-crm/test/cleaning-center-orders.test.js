'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('cleaning center contains 34 separate routes without duplicating primary CRM modules', () => {
  const html = read('desktop-crm/src/index.html');
  const start = html.indexOf('data-nav-folder="cleaning-center"');
  const end = html.indexOf('data-view="settings"', start);
  const folder = html.slice(start, end);
  assert.match(folder, /data-cleaning-pages-nav/u);
  const pages = require('../src/cleaning-center-pages');
  assert.equal(pages.SCREENS.length, 34);
  const navigation = pages.renderNavigation();
  assert.equal([...navigation.matchAll(/data-cleaning-screen="\d{2}"/gu)].length, 34);
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

test('completed-order detail exposes a separate rework action and a CRM rework form', () => {
  const ui = require('../src/cleaning-center-ui');
  const detail = ui.renderOrderDetails({ id: '123e4567-e89b-42d3-a456-426614174000', status: 'completed', canManageRework: true });
  assert.match(detail, /manage-cleaning-rework/u);
  assert.equal(typeof ui.renderCleaningReworkDialog, 'function');
  const dialog = ui.renderCleaningReworkDialog({ order: { id: '123e4567-e89b-42d3-a456-426614174000', status: 'completed' },
    requests: [{ requestId: '223e4567-e89b-42d3-a456-426614174000', revision: 4, status: 'awaiting_review', complaintTitle: '재작업', complaintDetail: '주방 확인', areas: ['kitchen'], desiredAt: '2026-10-01T00:00:00.000Z', events: [] }],
    reports: [{ id: 'work_report_01', title: '재작업 결과보고' }], canManage: true });
  assert.match(dialog, /cleaning-rework-create-form/u);
  assert.match(dialog, /고객 안내/u);
  assert.match(dialog, /검수 결과보고서/u);
});

test('rework data travels through the authenticated CRM preload bridge and stays local-only in preview', () => {
  const policy = require('../src/mutation-policy');
  for (const [channel, type] of [
    ['crm:cleaning-rework-load', 'control'],
    ['crm:cleaning-rework-create', 'mutation'],
    ['crm:cleaning-rework-complete', 'mutation'],
  ]) {
    assert.doesNotThrow(() => policy.assertRegistered(channel));
    assert.equal(policy.classification(channel), type);
  }
  const preload = read('desktop-crm/src/preload.js');
  const main = read('desktop-crm/src/main.js');
  const remote = read('desktop-crm/src/remote.js');
  for (const method of ['loadCleaningReworkRequests', 'createCleaningReworkRequest', 'completeCleaningRework']) assert.match(preload, new RegExp(`${method}:`, 'u'));
  for (const channel of ['crm:cleaning-rework-load', 'crm:cleaning-rework-create', 'crm:cleaning-rework-complete']) assert.ok(main.includes(channel));
  for (const method of ['loadCleaningReworkRequests', 'createCleaningReworkRequest', 'completeCleaningRework']) assert.match(remote, new RegExp(`${method}\\(`, 'u'));
});

test('cleaning cancellation dialog records the selected reason and refund follow-up without pretending to refund or notify', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.renderCancellationConfirmation({ orderId: 'cancel-order', orderTitle: '입주 청소 24평', customerName: '김민수', buildingName: '원주시 무실로 123', expectedRevision: 3, requestId: 'request-1' });
  assert.match(html, /주문 취소/u);
  assert.match(html, /취소 사유/u);
  assert.match(html, /환불 처리/u);
  assert.match(html, /안내 메시지는 자동 발송되지 않으며/u);
  assert.match(html, /data-order-id="cancel-order"[^>]*data-next-status="cancelled"/u);
  const eligibleDetail = ui.renderOrderDetails({ id: 'cancel-order', status: 'scheduled', canCancelCleaningOrder: true });
  const activeDetail = ui.renderOrderDetails({ id: 'cancel-order', status: 'in_progress', canCancelCleaningOrder: true });
  assert.match(eligibleDetail, /data-action="cancel-cleaning-order" data-order-id="cancel-order"/u);
  assert.doesNotMatch(activeDetail, /data-action="cancel-cleaning-order"/u);
  const app = read('desktop-crm/src/app.js');
  const handlerStart = app.indexOf('if (form.id === "cleaningOrderCancellationForm")');
  const handlerEnd = app.indexOf('if (form.id === "cleaningOrderTransitionForm")', handlerStart);
  const handler = app.slice(handlerStart, handlerEnd);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.match(handler, /api\.transitionCleaningOrder\(/u);
  assert.match(handler, /refundTreatment/u);
  assert.match(handler, /notifyCustomer/u);
  assert.match(handler, /취소 사유:/u);
  assert.doesNotMatch(handler, /sendCustomerMessage|dispatchCustomerMessage/u);
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
  assert.match(app, /button\.classList\.toggle\("is-active", button\.dataset\.cleaningStatusPreset === status\)/u);
});

test('cleaning settlement review IPC is read-only, administrator-scoped, and unavailable in local preview', async () => {
  const { createCleaningOrderIpcHandlers } = require('../src/cleaning-order-ipc');
  const calls = [];
  const remoteClient = {
    loadCleaningSettlementReview: async period => { calls.push(period); return { partners: [], payoutEnabled: false }; },
  };
  const handlers = createCleaningOrderIpcHandlers({ getRemoteClient: () => remoteClient, isLocalTestMode: () => false });
  const period = { fromDate: '2026-09-21', toDate: '2026-09-27' };
  assert.deepEqual(await handlers.loadSettlementReview(period), { partners: [], payoutEnabled: false });
  assert.deepEqual(calls, [period]);
  assert.throws(() => handlers.loadSettlementReview({ ...period, extra: true }), /정산 기간/u);
  assert.throws(() => handlers.loadSettlementReview({ fromDate: '2026-02-30', toDate: '2026-09-27' }), /정산 기간/u);

  const localHandlers = createCleaningOrderIpcHandlers({ getRemoteClient: () => remoteClient, isLocalTestMode: () => true });
  assert.deepEqual(await localHandlers.loadSettlementReview(period), { ...period, completedWorkCount: 0,
    grossSupplierAmount: 0, excludedWorkCount: 0, partners: [], localOnly: true, payoutEnabled: false });
  assert.equal(calls.length, 1, 'local review must not request company settlement data');
});

test('cleaning pricing policy screen matches the supplied versioned table and exposes editable policy fields', () => {
  const ui = require('../src/cleaning-center-ui');
  const markup = ui.renderCleaningPricingPolicyDialog({ policies: [], today: '2026-09-28' });
  for (const text of ['가격정책 설정', '적용 지역', '적용 시작일', '주거 형태', '18평 이하', '19~24평', '25~30평', '31~34평', '35평 이상', '베란다 청소', '창틀 청소', '에어컨 분해 청소', '폐기물 처리', '쿠폰/프로모션 최대 할인 한도', '멤버십 추가 할인 한도', '기존 확정 주문 금액은 변경하지 않습니다']) {
    assert.ok(markup.includes(text), `pricing-policy dialog is missing: ${text}`);
  }
  for (const selector of ['data-cleaning-pricing-policy-form', 'data-cleaning-pricing-base', 'data-cleaning-pricing-addon', 'data-cleaning-pricing-save']) {
    assert.ok(markup.includes(selector), `pricing-policy form is missing: ${selector}`);
  }
  const adminCenter = ui.render({ canManagePricingPolicies: true });
  const readOnlyCenter = ui.render({ canManagePricingPolicies: false });
  assert.match(adminCenter, /data-action="open-cleaning-pricing-policy"/u);
  assert.doesNotMatch(readOnlyCenter, /data-action="open-cleaning-pricing-policy"/u);
  const app = read('desktop-crm/src/app.js');
  assert.match(app, /api\.saveCleaningPricingPolicy\(\{ requestId, policy \}\)/u);
  assert.match(app, /data-action="apply-cleaning-price-policy"/u);
  assert.match(app, /selectCleaningPricingPolicy\(cleaningPricingPolicyState\.policies, region, quoteDate\)/u);
  assert.match(app, /cleaningQuotePricingMarkup\(\)\}\$\{cleaningQuotePriceReviewMarkup/u);
  assert.match(app, /정책 \$\{policy\.policyId\} · \$\{policy\.effectiveFrom\}/u);
});

test('cleaning quote policy uses the effective regional version and respects add-on and discount caps', () => {
  const ui = require('../src/cleaning-center-ui');
  const policy = {
    policyId: 'wonju_20261001', name: '원주 가격표', region: '원주시', effectiveFrom: '2026-10-01', publication: 'published',
    basePrices: { apartment: [180000, 240000, 280000, 320000, 360000], villa: [160000, 220000, 260000, 300000, 340000], detached: [200000, 260000, 320000, 360000, 400000] },
    addOns: [{ id: 'balcony', name: '베란다 청소', description: '', amount: 20000 }],
    discountCaps: { promotion: 50000, membership: 30000 },
  };
  const old = { ...policy, policyId: 'old', effectiveFrom: '2026-01-01', basePrices: { ...policy.basePrices, apartment: [100000, 110000, 120000, 130000, 140000] } };
  assert.equal(ui.selectCleaningPricingPolicy([{ policy }, { policy: old }], '원주시', '2026-10-02').policyId, policy.policyId);
  assert.equal(ui.selectCleaningPricingPolicy([{ policy }], '횡성군', '2026-10-02'), null);
  assert.equal(ui.selectCleaningPricingPolicy([{ policy }], '원주시', '2026-09-30'), null);
  assert.deepEqual(ui.calculateCleaningPrice(policy, { housingType: 'apartment', areaPyeong: 24, addOnIds: ['balcony'], promotionDiscount: 80000, membershipDiscount: 50000 }), {
    policyId: policy.policyId, baseAmount: 240000, addOnAmount: 20000, promotionDiscount: 50000, membershipDiscount: 30000, totalAmount: 180000,
    addons: policy.addOns,
  });
  assert.throws(() => ui.calculateCleaningPrice(policy, { housingType: 'apartment', areaPyeong: 24, addOnIds: ['missing'], promotionDiscount: 0, membershipDiscount: 0 }));
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
  assert.match(smoke, /data-cleaning-screen="03"/u);
  assert.match(smoke, /dashboardVisible/u);
  assert.match(smoke, /dashboardFocused/u);
  assert.match(smoke, /data-cleaning-screen="01"/u);
  assert.match(smoke, /data-cleaning-screen="08"/u);
  assert.match(smoke, /data-cleaning-screen="09"/u);
  assert.match(smoke, /cleaningDispatchTowerVisible/u);
  assert.match(smoke, /배차 관제/u);
  assert.match(smoke, /cleaningScheduleCalendarVisible/u);
  assert.match(smoke, /data-cleaning-schedule-date/u);
  assert.match(smoke, /cleaningScheduleNavigationWorks/u);
});

test('isolated CRM screenshot action opens the focused Cleaning Center dashboard', () => {
  const main = read('desktop-crm/src/main.js');
  assert.match(main, /cleaning-center-summary-preview/u);
  assert.match(main, /dashboardFocused && cards\.length === 6/u);
  assert.match(main, /\.cleaning-dashboard/);
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

test('cleaning order detail opens the existing CRM message composer for its canonical customer and order', () => {
  const ui = require('../src/cleaning-center-ui');
  const detail = ui.renderOrderDetails({ id: 'BR-260926-00128', customerId: 'customer-1', canMessageCustomer: true });
  const app = read('desktop-crm/src/app.js');
  assert.match(detail, /data-action="open-cleaning-order-message" data-order-id="BR-260926-00128"/u);
  assert.match(app, /selectedMessageSourceType\s*=\s*["']cleaningOrder["']/u);
  assert.match(app, /selectedMessageSourceId\s*=\s*order\.id/u);
  assert.match(app, /currentView\s*=\s*["']customerMessages["']/u);
});

test('cleaning refund flow is connected from the order detail action through guarded request, decision, and evidence forms', () => {
  const ui = require('../src/cleaning-center-ui');
  const detail = ui.renderOrderDetails({ id: 'order-refund-1', canManageRefund: true });
  assert.match(detail, /data-action="manage-cleaning-refund"/u);
  const dialog = ui.renderCleaningRefundDialog({
    order: { id: 'order-refund-1', customerName: '고객 A' },
    canManage: true,
    payment: { paidAmount: 270000, remainingAmount: 240000 },
    requests: [{ requestId: 'refund-1', type: 'partial', amount: 30000, reason: '고객 요청', status: 'pending', revision: 1, remainingPaidAmount: 240000, createdAt: '2026-09-28', events: [] }],
  });
  assert.match(dialog, /id="cleaningRefundForm"/u);
  assert.match(dialog, /cleaning-refund-order-summary/u);
  assert.match(dialog, /cleaning-refund-amount-preview/u);
  assert.match(dialog, /name="type" value="partial"/u);
  assert.match(dialog, /name="type" value="full"/u);
  assert.match(dialog, /환불 후 결제 금액/u);
  assert.match(dialog, /기존 결제 수단/u);
  assert.match(dialog, /변경 이력 \(감사 로그\)/u);
  assert.match(dialog, /cleaning-refund-decision-form/u);
  assert.match(dialog, /data-refund-id="refund-1"/u);

  const app = read('desktop-crm/src/app.js');
  for (const value of ['manage-cleaning-refund', 'loadCleaningRefundRequests', 'createCleaningRefundRequest', 'decideCleaningRefundRequest', 'recordCleaningRefundExecution']) {
    assert.ok(app.includes(value), `${value} must be wired into the CRM screen`);
  }
  assert.match(app, /canManageRefund:\s*canAdministerSecurity\(\)/u);
  for (const form of ['cleaningRefundForm', 'cleaning-refund-decision-form', 'cleaning-refund-execution-form']) assert.ok(app.includes(form), `${form} submit handler missing`);
  const policy = require('../src/mutation-policy');
  for (const [channel, type] of [
    ['crm:cleaning-refunds-load', 'control'],
    ['crm:cleaning-refund-create', 'mutation'],
    ['crm:cleaning-refund-decide', 'mutation'],
    ['crm:cleaning-refund-execution', 'mutation'],
  ]) {
    assert.doesNotThrow(() => policy.assertRegistered(channel));
    assert.equal(policy.classification(channel), type);
  }
  const preload = read('desktop-crm/src/preload.js');
  const main = read('desktop-crm/src/main.js');
  for (const method of ['loadCleaningExtraChargeRequests', 'createCleaningExtraChargeRequest', 'recordCleaningExtraChargeDelivery', 'recordCleaningExtraChargeDecision']) {
    assert.ok(preload.includes(`${method}:`), `${method} must be exposed through the context bridge`);
  }
  for (const channel of ['crm:cleaning-extra-charges-load', 'crm:cleaning-extra-charge-create', 'crm:cleaning-extra-charge-delivery', 'crm:cleaning-extra-charge-decision']) {
    assert.ok(main.includes(`"${channel}"`), `${channel} must be handled in the main process`);
  }
});

test('cleaning extra-charge flow matches the customer approval screen and keeps approval separate from payment', () => {
  const ui = require('../src/cleaning-center-ui');
  const detail = ui.renderOrderDetails({ id: 'order-extra-1', canManageExtraCharge: true });
  assert.match(detail, /data-action="manage-cleaning-extra-charge"/u);
  const dialog = ui.renderCleaningExtraChargeDialog({
    order: { id: 'order-extra-1', customerName: '김민수', serviceType: 'move_in_cleaning', status: 'in_progress' },
    customer: { id: 'customer-1', phone: '010-***-5678' },
    partner: { id: 'partner-1', name: 'A클린' },
    requests: [
      { requestId: 'request-1', serviceType: 'waste_disposal', amount: 13000, reason: '현장 확인 결과 대형 폐기물 발생', evidenceFileIds: ['drive-1'], status: 'awaiting_customer_approval', revision: 2, communication: { status: 'accepted' }, events: [] },
      { requestId: 'request-2', serviceType: 'window_cleaning', amount: 10000, reason: '초안', evidenceFileIds: [], status: 'draft', revision: 1, communication: { status: 'not_sent' }, events: [] },
      { requestId: 'request-3', serviceType: 'other', amount: 1000, reason: '발송 실패', evidenceFileIds: [], status: 'draft', revision: 2, communication: { status: 'failed' }, events: [] },
    ],
    canManage: true,
  });
  for (const value of ['추가금 승인 요청', '추가 서비스', '추가 금액', '추가금 사유', '사진 증빙', '최대 5장', '고객 승인 상태', 'draft', 'not_sent', 'evidenceRef', '추가금은 고객 승인 전 결제·정산에 반영되지 않습니다']) {
    assert.ok(dialog.includes(value), `${value} must appear in the extra-charge review flow`);
  }
  assert.match(dialog, /cleaning-extra-charge-create-form/u);
  assert.match(dialog, /cleaning-extra-charge-decision-form/u);
  assert.match(dialog, /data-request-id="request-1"/u);
  assert.match(dialog, /data-communication-status="failed"/u);
  assert.doesNotMatch(dialog, /결제 처리|정산 지급/u);
  const app = read('desktop-crm/src/app.js');
  for (const value of ['manage-cleaning-extra-charge', 'loadCleaningExtraChargeRequests', 'createCleaningExtraChargeRequest', 'recordCleaningExtraChargeDelivery', 'recordCleaningExtraChargeDecision', 'cleaning_extra_charge_approval', 'extraChargeRequestId', 'uploadBuildingDocument']) {
    assert.ok(app.includes(value), `${value} must be wired into the extra-charge workflow`);
  }
  const policy = require('../src/mutation-policy');
  for (const [channel, type] of [
    ['crm:cleaning-extra-charges-load', 'control'],
    ['crm:cleaning-extra-charge-create', 'mutation'],
    ['crm:cleaning-extra-charge-delivery', 'mutation'],
    ['crm:cleaning-extra-charge-decision', 'mutation'],
  ]) {
    assert.doesNotThrow(() => policy.assertRegistered(channel));
    assert.equal(policy.classification(channel), type);
  }
});

test('cleaning refund remote bridge uses authenticated admin requests and never calls a payment provider', async () => {
  const { FirebaseRemoteClient } = require('../src/remote');
  const remote = new FirebaseRemoteClient({ Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '' });
  remote.session = { uid: 'refund-admin', role: 'admin', mustChangePassword: false };
  remote.cleaningRefundsEndpoint = 'https://example.test/cleaningRefundsApi';
  remote.ensureIdToken = async () => 'refund-id-token';
  const sent = [];
  remote.fetch = async (url, options) => {
    sent.push({ url: new URL(url), options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: { requests: [], payment: { paidAmount: 10000, remainingAmount: 10000 }, request: { status: 'pending' } } }) };
  };
  const orderId = '123e4567-e89b-42d3-a456-426614174000';
  await remote.loadCleaningRefundRequests(orderId);
  await remote.createCleaningRefundRequest({ orderId, requestId: 'refund-1', type: 'partial', amount: 1000, reason: '고객 요청', paymentMethod: 'card', csReference: '', note: '' });
  await remote.decideCleaningRefundRequest({ orderId, requestId: 'refund-1', expectedRevision: 1, decision: 'approve', note: '확인 완료' });
  await remote.recordCleaningRefundExecution({ orderId, requestId: 'refund-1', expectedRevision: 2, providerRef: 'PG-1', evidenceRef: 'evidence-1' });
  assert.equal(sent[0].url.searchParams.get('orderId'), orderId);
  assert.deepEqual(sent.slice(1).map(item => JSON.parse(item.options.body).action), ['create', 'decide', 'record-execution']);
  assert.ok(sent.every(item => item.options.headers.Authorization === 'Bearer refund-id-token'));
  remote.session = { uid: 'refund-member', role: 'member', mustChangePassword: false };
  await assert.rejects(remote.createCleaningRefundRequest({ orderId } ), { code: 'ACCESS_DENIED' });
  assert.equal(sent.length, 4, 'refund operations are records only; no payment-provider endpoint is called');
});

test('delay response records expose incident history and guarded operator actions', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.renderCleaningPartnerDispatch({ order: { id: 'order-delay-1', title: '입주 청소' }, dispatch: {
    orderId: 'order-delay-1', revision: 4, acceptedOfferId: 'offer-delay-1',
    offers: [{ id: 'offer-delay-1', vendorId: 'vendor-delay-1', status: 'accepted', progress: 'departed', supplierAmount: 190000 }],
    events: [{ type: 'incident_reported', incidentId: 'incident-delay-1', issueType: 'departure_delay', delayMinutes: 18,
      scheduledAt: '2026-09-28T09:00:00.000Z', occurredAt: '2026-09-28T09:18:00.000Z', actorUid: 'admin-1', vendorId: 'vendor-delay-1', note: '<unsafe>' }],
  }, vendors: [{ id: 'vendor-delay-1', name: 'A클린' }] });
  assert.match(html, /지연·노쇼 기록/u);
  assert.match(html, /지연·노쇼 대응/u);
  assert.match(html, /자동 위치 추적이나 고객 알림은 실행하지 않습니다/u);
  assert.doesNotMatch(html, /<unsafe>/u);
  const app = read('desktop-crm/src/app.js');
  for (const value of ['cleaningDelayIncidentForm', 'recordCleaningDelayIncident', 'recordCleaningDelayAction', 'emergency_reassignment_requested']) assert.ok(app.includes(value));
  const policy = require('../src/mutation-policy');
  for (const channel of ['crm:cleaning-delay-incident-record', 'crm:cleaning-delay-action-record']) {
    assert.doesNotThrow(() => policy.assertRegistered(channel));
    assert.equal(policy.classification(channel), 'mutation');
  }
});

test('delay response screen follows the reference incident summary, three situations, actions, memo and timeline', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.renderCleaningDelayDialog({
    order: { id: 'order-delay-1', title: '입주 청소', customerName: '고객 A', desiredDate: '2026-09-28', region: '원주시 무실동' },
    partner: { id: 'vendor-delay-1', name: 'A클린' },
    dispatch: { revision: 4, acceptedOfferId: 'offer-delay-1', offers: [{ id: 'offer-delay-1', vendorId: 'vendor-delay-1', status: 'accepted', progress: 'departed' }], events: [] },
    incidents: [], activeIncident: null,
  });
  for (const value of ['지연·노쇼 대응', 'cleaning-delay-context', 'cleaning-delay-situations', 'cleaning-delay-actions', 'cleaning-delay-sla', 'cleaning-delay-timeline', '출발 지연', '현장 미도착', '노쇼 의심', '파트너 전화 확인', '고객 안내', '대체 파트너 검색', '대응 메모', '기준 미설정']) assert.ok(html.includes(value), `${value} missing from the reference-shaped delay screen`);
  assert.match(html, /예정 시각 미기록/u);
  assert.match(html, /위치 확인 불가/u);
  assert.doesNotMatch(html, /09:18|12분 남음/u);
});

test('cleaning refund preview clamps partial and full refunds to the remaining approved paid amount', () => {
  const ui = require('../src/cleaning-center-ui');
  assert.deepEqual(ui.previewCleaningRefund({ paidAmount: 270000, remainingAmount: 240000, amount: 30000, type: 'partial' }), {
    valid: true, refundAmount: 30000, paidAfterRefund: 240000, remainingAfterRequest: 210000,
  });
  assert.deepEqual(ui.previewCleaningRefund({ paidAmount: 270000, remainingAmount: 240000, amount: 250000, type: 'partial' }), {
    valid: false, refundAmount: 250000, paidAfterRefund: 20000, remainingAfterRequest: -10000,
  });
  assert.deepEqual(ui.previewCleaningRefund({ paidAmount: 270000, remainingAmount: 240000, amount: 0, type: 'full' }), {
    valid: true, refundAmount: 240000, paidAfterRefund: 30000, remainingAfterRequest: 0,
  });
});

test('delay operation bridge authenticates admins and only records staff-reported actions', async () => {
  const { FirebaseRemoteClient } = require('../src/remote');
  const remote = new FirebaseRemoteClient({ Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: '', pendingFile: '' });
  remote.session = { uid: 'delay-admin', role: 'admin', mustChangePassword: false };
  remote.cleaningPartnerEndpoint = 'https://example.test/cleaningPartnerApi';
  remote.ensureIdToken = async () => 'delay-id-token';
  const sent = [];
  remote.fetch = async (url, options) => {
    sent.push({ url, options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, result: { orderId: 'order-delay-1', revision: 3 } }) };
  };
  await remote.recordCleaningDelayIncident({ incidentId: 'incident-1', orderId: 'order-delay-1', expectedRevision: 2,
    issueType: 'departure_delay', scheduledAt: '2026-09-28T09:00:00.000Z', delayMinutes: 18, note: '확인' });
  await remote.recordCleaningDelayAction({ incidentId: 'incident-1', orderId: 'order-delay-1', expectedRevision: 3,
    action: 'customer_notice_logged', note: '운영자가 직접 안내 후 기록' });
  assert.deepEqual(sent.map(item => JSON.parse(item.options.body).action), ['delay-record-incident', 'delay-record-action']);
  assert.ok(sent.every(item => item.options.headers.Authorization === 'Bearer delay-id-token'));
  remote.session = { uid: 'delay-member', role: 'member', mustChangePassword: false };
  await assert.rejects(remote.recordCleaningDelayIncident({}), { code: 'ACCESS_DENIED' });
  assert.equal(sent.length, 2);
});

test('cleaning work order detail shows lifecycle from canonical status and actual acceptance criteria', () => {
  const ui = require('../src/cleaning-center-ui');
  assert.equal(ui.cleaningWorkOrderProgress({ status: 'assigned' }).activeIndex, 0);
  assert.equal(ui.cleaningWorkOrderProgress({ status: 'doing' }).activeIndex, 1);
  assert.equal(ui.cleaningWorkOrderProgress({ status: 'submitted' }).activeIndex, 2);
  assert.equal(ui.cleaningWorkOrderProgress({ status: 'returned' }).returned, true);
  assert.equal(ui.cleaningWorkOrderProgress({ status: 'done' }).complete, true);
  assert.equal(ui.cleaningWorkOrderProgress({ status: 'unmapped' }).activeIndex, -1);

  const html = ui.renderOrderDetails({
    id: 'order-work-criteria', title: '공용부 청소',
    relatedWorkOrders: [{ id: 'work-criteria', title: '계단 청소', status: 'returned', progress: 40,
      why: '입주 전 공용부 위생 확보', what: '<script>계단·난간 세척</script>',
      doneWhen: '체크리스트와 전후 사진 제출', startDate: '2026-09-28', dueDate: '2026-09-29' }],
  });
  assert.match(html, /작업 진행 단계/u);
  assert.match(html, /보완 요청/u);
  assert.match(html, /작업 목적/u);
  assert.match(html, /입주 전 공용부 위생 확보/u);
  assert.match(html, /&lt;script&gt;계단·난간 세척&lt;\/script&gt;/u);
  assert.match(html, /체크리스트와 전후 사진 제출/u);
  assert.match(html, /2026-09-28/u);
  assert.doesNotMatch(html, /<script>/u);

  const app = read('desktop-crm/src/app.js');
  const start = app.indexOf('const viewCleaningOrderDetails =');
  const handler = app.slice(start, app.indexOf('const manageQuoteButton =', start));
  for (const field of ['why: item.why', 'what: item.what', 'doneWhen: item.doneWhen', 'startDate: item.startDate']) {
    assert.ok(handler.includes(field), `${field} missing from work order detail mapping`);
  }
});

test('cleaning photo review exposes real before and after Drive photos beside checklist gaps', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.renderOrderDetails({
    id: 'order-photo-review', status: 'review_pending',
    relatedReports: [{ id: 'report-photo-review', title: '현장 결과 보고', workDate: '2026-09-28', photoCount: 3,
      checklistSummary: { progress: 50, done: 1, partial: 0, skipped: 0, items: [
        { key: 'stairs', label: '계단', statusLabel: '완료', beforeCount: 1, afterCount: 2,
          before: [{ id: 'before-photo', driveFileId: 'drive-before', caption: '작업 전 계단' }],
          after: [{ id: 'after-photo-1', driveFileId: 'drive-after-1', caption: '작업 후 1' }, { id: 'after-photo-2', driveFileId: 'drive-after-2', caption: '작업 후 2' }] },
      ] } }],
  });
  assert.match(html, /사진 검수/u);
  assert.match(html, /data-report-drive-thumbnail="drive-before"/u);
  assert.match(html, /data-report-drive-thumbnail="drive-after-1"/u);
  assert.match(html, /작업 전 계단/u);
  assert.match(html, /작업 후 2/u);
  assert.match(html, /data-action="open-cleaning-report" data-record-id="report-photo-review"/u);
  const app = read('desktop-crm/src/app.js');
  assert.match(app, /before: \(entry\.before \|\| \[\]\)\.slice\(0, 4\)\.map/u);
  assert.match(app, /after: \(entry\.after \|\| \[\]\)\.slice\(0, 4\)\.map/u);
  assert.match(app, /scheduleReportDriveThumbnailLoading\(\)/u);
});

test('cleaning support panel shows active CRM cases for order buildings without claiming a direct order link', () => {
  const ui = require('../src/cleaning-center-ui');
  const data = { casesLoaded: true, cleaningCases: [
    { id: 'case-open', ticketNo: 'CS-100', name: '고객 A', buildingName: '햇빛빌라', issueType: '누수 확인', urgency: '긴급', currentStep: '현장 확인', percent: 35, visitDate: '2026-09-29' },
    { id: 'case-done', ticketNo: 'CS-101', name: '고객 B', buildingName: '한솔빌딩', issueType: '소모품 문의', urgency: '일반', currentStep: '완료', percent: 100, done: true },
  ] };
  const summary = ui.summarizeCleaningSupport(data);
  assert.equal(summary.state, 'ready');
  assert.equal(summary.total, 2);
  assert.equal(summary.open, 1);
  assert.equal(summary.urgent, 1);
  const html = ui.renderCleaningSupportPanel(data);
  assert.match(html, /고객 요청·A\/S/u);
  assert.match(html, /CS-100/u);
  assert.match(html, /긴급/u);
  assert.match(html, /현장 확인/u);
  assert.match(html, /2026-09-29/u);
  assert.match(html, /data-cleaning-case-open="case-open"/u);
  assert.match(html, /동일 건물의 CRM 민원/u);
  assert.match(html, /직접 연결된 A\/S 기록으로 단정하지 않습니다/u);
  assert.match(ui.renderCleaningSupportPanel({ casesLoaded: true, cleaningCases: [] }), /표시할 고객 민원·요청이 없습니다/u);
  assert.match(ui.renderCleaningSupportPanel({ casesLoaded: false }), /CRM 민원 자료를 불러오는 중/u);
  const app = read('desktop-crm/src/app.js');
  assert.match(app, /const cleaningCases = activeCases\(\)\.flatMap/u);
  assert.match(app, /caseBelongsToBuilding\(item, candidate\)/u);
  assert.match(app, /const cleaningCaseOpen = event\.target\.closest\('\[data-cleaning-case-open\]'\)/u);
});

test('cleaning payment panel counts only explicitly linked canonical invoice and approved receipt records', () => {
  const ui = require('../src/cleaning-center-ui');
  const data = { billingLoaded: true, cleaningPayments: [
    { orderId: 'order-paid', orderTitle: '입주 청소', buildingName: '햇빛빌라', desiredDate: '2026-09-27',
      invoiceId: 'invoice-1', invoiceAmount: 120000, invoiceStatus: '확정', paymentState: '부분입금', paidAmount: 50000 },
    { orderId: 'order-unbilled', orderTitle: '계단 청소', buildingName: '한솔빌딩', desiredDate: '2026-09-28', paymentState: '청구 장부에 연결된 기록 없음' },
  ] };
  const summary = ui.summarizeCleaningPayments(data);
  assert.equal(summary.state, 'ready');
  assert.equal(summary.orders, 2);
  assert.equal(summary.linkedInvoices, 1);
  assert.equal(summary.received, 50000);
  assert.equal(summary.unlinked, 1);
  const html = ui.renderCleaningPayments(data);
  assert.match(html, /결제·정산/u);
  assert.match(html, /120,000원/u);
  assert.match(html, /50,000원/u);
  assert.match(html, /부분입금/u);
  assert.match(html, /data-action="view-cleaning-order-details" data-order-id="order-paid">환불·주문 상세/u);
  assert.match(html, /청구 장부에 연결된 기록 없음/u);
  assert.match(html, /data-cleaning-payment-tab="customer"/u);
  assert.match(html, /data-cleaning-payment-tab="partner"/u);
  assert.match(html, /data-cleaning-payment-tab="refund"/u);
  assert.match(html, /data-cleaning-payment-tab="unpaid"/u);
  assert.match(html, /class="cleaning-payment-table"/u);
  assert.match(html, /<th scope="col">청구 확정액<\/th>/u);
  assert.match(html, /<th scope="col">승인 입금액<\/th>/u);
  assert.match(html, /<th scope="col">결제 상태<\/th>/u);
  assert.match(html, /청구 확정액.*120,000원/u);
  assert.match(html, /승인 입금액.*50,000원/u);
  assert.match(html, /완료된 CRM 청소 주문의 수락 공급가 합계/u);
  assert.match(html, /관리자 권한으로 로그인하면 주간 정산 검토 자료를 확인/u);
  const unbilledRowStart = html.indexOf('order-unbilled');
  const unbilledRow = html.slice(unbilledRowStart, html.indexOf('</tr>', unbilledRowStart));
  assert.doesNotMatch(unbilledRow, /0원/u);
  assert.match(ui.renderCleaningPayments({ billingLoaded: false }), /청구 장부를 불러오는 중/u);
  const app = read('desktop-crm/src/app.js');
  assert.match(app, /api\.loadBillingLedger\(\)/u);
  assert.match(app, /api\.loadCleaningSettlementReview\(currentCleaningSettlementPeriod\(\)\)/u);
  assert.match(app, /settlementReview: cleaningSettlementState\.review/u);
  assert.match(app, /selectedSettlementVendorId: cleaningSettlementState\.selectedVendorId/u);
  const uiSource = read('desktop-crm/src/cleaning-center-ui.js');
  assert.match(uiSource, /invoice\.occurrenceId === String\(order\.id \|\| ""\)/u);
  assert.match(app, /BringCleaningCenterUI\.buildCleaningPayments/u);
  assert.match(app, /function openBillingLedger\(contractId, cleaningOrderId = ""\)/u);
  assert.match(app, /cleaningOrderId: cleaningOrder\?\.id \|\| ""/u);
  assert.match(app, /cleaningOrder\?\.quoteSummary\?\.status === "admin_approved"[\s\S]*?Number\.isSafeInteger\(cleaningOrder\.quoteSummary\.totalAmount\)[\s\S]*?관리자 승인 견적 확인 필요/u);
  assert.match(app, /name="month" type="month"/u);
  assert.match(ui.render({}).toString(), /data-cleaning-scroll-target="cleaning-payments-panel"/u);
  assert.match(ui.render({}).toString(), /data-cleaning-scroll-target="cleaning-dispatch-tower"/u);
  assert.match(app, /cleaningSectionJump\.dataset\.cleaningScrollTarget/u);
  assert.match(app, /\$\{cleaningOrder \|\| editInvoice \? "readonly" : "required"\}/u);
  assert.match(app, /proposalContract = \{ \.\.\.contract, amount, workDate: order\.desiredDate, paymentDueDate: order\.desiredDate, occurrenceId: order\.id \}/u);
  assert.match(app, /BringBillingLedgerCore\.proposeInvoice\(proposalContract, month, state\.ledger\.invoices\)/u);
});

test('partner settlement panel totals only completed accepted offers and keeps unknown payout checks disabled', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.renderCleaningPayments({ billingLoaded: true, cleaningPayments: [{ orderId: 'billing-row', paymentState: 'unknown' }], settlementReview: {
    fromDate: '2026-09-21', toDate: '2026-09-27', completedWorkCount: 27,
    grossSupplierAmount: 4820000, excludedWorkCount: 2, payoutEnabled: false,
    partners: [{ vendorId: 'vendor-a', vendorName: 'A클린', completedWorkCount: 27, grossSupplierAmount: 4820000,
      workItems: [{ orderId: 'order-a', desiredDate: '2026-09-25', supplierAmount: 190000 }],
      checks: { workCompletion: 'verified', customerInspection: 'unavailable', csHold: 'unavailable',
        payoutAccount: 'unavailable', taxInvoice: 'unavailable' }, finalPayoutAmount: null, payoutEnabled: false }],
  } });
  assert.match(html, /파트너.*정산 검토/u);
  assert.match(html, /A클린/u);
  assert.match(html, /4,820,000원/u);
  assert.match(html, /완료 공급가/u);
  assert.match(html, /검수 승인 연결 필요/u);
  assert.match(html, /지급 계좌 확인 필요/u);
  assert.match(html, /최종 지급액 확인 불가/u);
  assert.match(html, /정산 검토 상세/u);
  assert.match(html, /완료 작업 정산 금액/u);
});

test('partner settlement review dialog follows the reference finalization hierarchy without inventing bank details', () => {
  const ui = require('../src/cleaning-center-ui');
  const review = { fromDate: '2026-09-21', toDate: '2026-09-27', completedWorkCount: 2, grossSupplierAmount: 410000,
    payoutEnabled: false, partners: [{ vendorId: 'vendor-a', vendorName: 'A클린', completedWorkCount: 2,
      grossSupplierAmount: 410000, checks: { workCompletion: 'verified', customerInspection: 'unavailable', csHold: 'unavailable',
        payoutAccount: 'unavailable', taxInvoice: 'unavailable' }, finalPayoutAmount: null, payoutEnabled: false }] };
  const html = ui.renderCleaningSettlementDialog({ review, vendorId: 'vendor-a' });
  for (const text of ['정산 확정·지급', 'A클린', '2026-09-21', '410,000원', '검수 승인 확인 필요', 'CS 보류 자료 확인 필요',
    '지급 계좌 확인 필요', '세금계산서 확인 필요', '최종 지급액 확인 불가', '지급 예정일 확인 필요', '승인자 정보 미연결']) assert.ok(html.includes(text), text);
  assert.match(html, /검수·CS·계좌·세금 확인 자료가 연결되기 전에는 지급을 확정할 수 없습니다/u);
  assert.match(html, /button[^>]*disabled[^>]*>정산 확정·지급/u);
  assert.doesNotMatch(html, /123-45|국민은행|BR20\d{10}/u);
  const app = read('desktop-crm/src/app.js');
  assert.match(app, /data-action="open-cleaning-settlement-review"/u);
  assert.match(app, /renderCleaningSettlementDialog\(\{ review: cleaningSettlementState\.review, vendorId: cleaningSettlementState\.selectedVendorId \}\)/u);
});

test('cleaning order detail points out checklist gaps without claiming server approval', () => {
  const ui = require('../src/cleaning-center-ui');
  const base = {
    id: 'order-review-1', buildingId: 'building-1', status: 'review_pending',
    history: [{ status: 'in_progress', changedAt: '2026-09-27T01:00:00.000Z' }],
    reportTemplate: { kind: 'stairs', items: [{ key: 'stairFloor', label: '계단실 바닥', optional: false }, { key: 'handrail', label: '난간', optional: false }] },
  };
  const report = {
    id: 'report-1', kind: 'stairs', buildingId: 'building-1', updatedAt: '2026-09-27T02:00:00.000Z',
    checklistSummary: { items: [
      { key: 'stairFloor', label: '계단실 바닥', status: 'done', beforeCount: 1, afterCount: 0 },
      { key: 'handrail', label: '난간', status: 'skipped', note: '' },
    ] },
  };
  const gaps = ui.reviewChecklistGaps({ ...base, relatedReports: [report] });
  assert.ok(gaps.some(value => value.includes('계단실 바닥') && value.includes('작업 후 사진')));
  assert.ok(gaps.some(value => value.includes('난간') && value.includes('미수행 사유')));
  const html = ui.renderOrderDetails({ ...base, relatedReports: [report] });
  assert.match(html, /검수 준비 점검/u);
  assert.match(html, /최종 완료 여부는 서버가/u);
  assert.match(html, /작업 후 사진/u);
  assert.doesNotMatch(html, /완료 승인됨/u);
  assert.ok(ui.reviewChecklistGaps({ ...base, relatedReports: [] }).some(value => value.includes('결과보고서')));
  assert.ok(ui.reviewChecklistGaps({ ...base, reportsLoadError: true, relatedReports: [] }).some(value => value.includes('불러오지 못했습니다')));
  assert.ok(ui.reviewChecklistGaps({ ...base, relatedReports: [{ ...report, kind: 'common' }] }).some(value => value.includes('서비스 유형')));
  assert.ok(ui.reviewChecklistGaps({ ...base, relatedReports: [{ ...report, updatedAt: '2026-09-26T02:00:00.000Z' }] }).some(value => value.includes('이번 작업')));
  assert.ok(ui.reviewChecklistGaps({ ...base, relatedReports: [{ ...report, checklistSummary: { items: [report.checklistSummary.items[0]] } }] }).some(value => value.includes('난간') && value.includes('누락')));
  assert.ok(ui.reviewChecklistGaps({ ...base, relatedReports: [{ ...report, reviewItems: [report.checklistSummary.items[0]] }] }).some(value => value.includes('난간') && value.includes('누락')));
  const complete = { ...report, checklistSummary: { items: [
    { ...report.checklistSummary.items[0], afterCount: 1 },
    { ...report.checklistSummary.items[1], note: '현장 접근 불가' },
  ] } };
  assert.deepEqual(ui.reviewChecklistGaps({ ...base, relatedReports: [complete] }), []);
  assert.match(ui.renderOrderDetails({ ...base, relatedReports: [complete] }), /화면상 필수 항목이 등록됐습니다/u);
});

test('CRM order detail supplies report type, building, checklist keys and report-load state to the review guide', () => {
  const app = read('desktop-crm/src/app.js');
  const start = app.indexOf('const viewCleaningOrderDetails =');
  const handler = app.slice(start, app.indexOf('const manageQuoteButton =', start));
  for (const field of ['reportTemplate:', 'reportsLoadError:', 'reviewItems:', 'kind: rawReport.kind', 'buildingId: rawReport.buildingId', 'updatedAt: rawReport.updatedAt', 'key: entry.key', 'status: entry.status']) {
    assert.ok(handler.includes(field), `${field} missing from order detail mapping`);
  }
});

test('cleaning order row exposes a detail action wired to a read-only CRM modal', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({ orders: [{ id: 'order-modal-1', title: '계단 청소', status: 'received' }] });
  assert.match(html, /data-action="view-cleaning-order-details" data-order-id="order-modal-1"/u);
  const app = read('desktop-crm/src/app.js');
  const start = app.indexOf("const viewCleaningOrderDetails = event.target.closest('[data-action=\"view-cleaning-order-details\"]')");
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

test('cleaning operations dashboard derives its KPIs and trends from loaded CRM orders and linked reports', () => {
  const ui = require('../src/cleaning-center-ui');
  const orders = [
    {
      id: 'clean-1', title: '입주 청소', status: 'in_progress', serviceType: 'move_in_cleaning', customerId: 'customer-1', customerName: '김민수', customerPhone: '010-1234-5678',
      createdAt: '2026-09-28T10:00:00+09:00', desiredDate: '2026-09-28', buildingName: '한빛빌딩',
      buildingAddress: '서울특별시 강남구 역삼동 1',
      relatedWorkOrders: [{ status: 'assigned' }],
      relatedReports: [{ workDate: '2026-09-28' }],
      history: [{ status: 'in_progress', changedAt: '2026-09-28T11:00:00+09:00' }],
    },
    { id: 'clean-2', title: '공용부 청소', status: 'review_pending', serviceType: 'common_cleaning', createdAt: '2026-09-27T13:00:00+09:00', buildingAddress: '서울특별시 강남구 역삼동 2' },
  ];
  const summary = ui.summarizeCleaningDashboard({
    orders, ordersLoaded: true, ordersHasMore: false,
    reportsLoaded: true, reportsError: '', asOf: '2026-09-28',
  });
  assert.equal(summary.state, 'ready');
  assert.equal(summary.todayReceived, 1);
  assert.equal(summary.inProgress, 1);
  assert.equal(summary.reviewPending, 1);
  assert.equal(summary.assigned, 1);
  assert.equal(summary.days.at(-1).orders, 1);
  assert.equal(summary.days.at(-1).reports, 1);
  assert.equal(summary.regions[0].region, '강남구');
  assert.equal(summary.regions[0].count, 2);
  const failed = ui.summarizeCleaningDashboard({ orders, ordersLoaded: false, ordersLoading: false, ordersError: 'network', reportsLoaded: false, asOf: '2026-09-28' });
  assert.equal(failed.state, 'error');
  assert.equal(failed.total, 0);
  assert.equal(failed.regions.length, 0);
  assert.equal(failed.services.length, 0);
  assert.equal(failed.days.at(-1).orders, 0);
  assert.equal(failed.days.at(-1).reports, 0);
  const html = ui.render({ orders, ordersLoaded: true, reportsLoaded: true, asOf: '2026-09-28', nowMs: Date.parse('2026-09-28T12:00:00+09:00'), orderStatusFilter: 'review_pending' });
  assert.match(html, /안녕하세요\. 오늘의 청소 운영 현황입니다\./u);
  assert.match(html, /오늘 매출/u);
  assert.match(html, /청소 주문과 확정 청구·입금 장부가 연결되면 표시합니다/u);
  assert.match(html, /최근 7일/u);
  assert.match(html, /지역별 주문 현황/u);
  assert.match(html, /cleaning-lead-queue/u);
  assert.match(html, /cleaning-order-lead-meta/u);
  assert.match(html, /접수 \d{2}\. \d{2}\. 10:00 · 2시간 0분 경과/u);
  assert.match(html, /010-1234-5678/u);
  assert.match(html, /유입경로 미기록/u);
  assert.match(html, /data-customer-open="customer-1"/u);
  assert.match(html, /data-cleaning-status-preset="quote_pending,approval_pending"/u);
  assert.match(html, /data-cleaning-status-preset="review_pending" class="is-active"/u);
  assert.doesNotMatch(html, /서울특별시 강남구 역삼동 1/u);
});

test('cleaning dashboard empty service and alert messages occupy a readable full-width row', () => {
  const css = read('desktop-crm/src/cleaning-center.css');
  assert.match(css, /\.cleaning-dashboard-service li\.cleaning-dashboard-muted,\.cleaning-dashboard-alerts li\.cleaning-dashboard-muted\s*\{[^}]*grid-column:\s*1\s*\/\s*-1[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/u);
});

test('cleaning schedule calendar groups canonical orders by desired date and opens their details', () => {
  const ui = require('../src/cleaning-center-ui');
  const data = {
    ordersLoaded: true, asOf: '2026-09-28', scheduleMonth: '2026-09', selectedScheduleDate: '2026-09-28',
    orders: [
      { id: 'today-order', title: '입주 청소', status: 'scheduled', statusLabel: '일정 확정', desiredDate: '2026-09-28', serviceType: 'move_in_cleaning', customerName: '김민수', buildingName: '한빛빌라', buildingAddress: '강원도 원주시 무실동' },
      { id: 'month-order', title: '공용부 청소', status: 'approval_pending', desiredDate: '2026-09-28', serviceType: 'common_cleaning', customerName: '박지은', buildingName: '한솔빌딩' },
      { id: 'next-month-order', title: '계단 청소', status: 'scheduled', desiredDate: '2026-10-01', serviceType: 'stair_cleaning' },
      { id: 'no-date-order', title: '날짜 미정 요청', status: 'reviewing' },
    ],
  };
  const summary = ui.summarizeCleaningSchedule(data);
  assert.equal(summary.state, 'ready');
  assert.equal(summary.monthLabel, '2026년 9월');
  assert.equal(summary.monthTotal, 2);
  assert.equal(summary.selectedDateTotal, 2);
  assert.equal(summary.days.find(item => item.date === '2026-09-28').count, 2);
  const html = ui.renderCleaningSchedule(data);
  assert.match(html, /일정 &amp; 지도 관제|일정·지도 관제/u);
  assert.match(html, /data-cleaning-schedule-shift="-1"/u);
  assert.match(html, /data-cleaning-schedule-date="2026-09-28"/u);
  assert.match(html, /today-order/u);
  assert.match(html, /한빛빌라/u);
  assert.match(html, /주문에 지도 좌표가 저장되지 않아/u);
  assert.doesNotMatch(html, /next-month-order/u);
  assert.match(ui.render({ ...data, reportsLoaded: true }), /id="cleaningScheduleTitle"/u);
  const app = read('desktop-crm/src/app.js');
  assert.match(app, /cleaningScheduleMonth = WorkCalendar\.shiftMonth/u);
  assert.match(app, /cleaningScheduleDateButton\.dataset\.cleaningScheduleDate/u);
});

test('cleaning order quote drafts require current per-item price confirmation', () => {
  const ui = require('../src/cleaning-center-ui');
  const items = [{ unitPrice: 1000 }, { unitPrice: 250000 }];
  assert.equal(ui.cleaningQuotePricesConfirmed(items, [], [0, 1]), false);
  assert.equal(ui.cleaningQuotePricesConfirmed(items, [0], [0, 1]), false);
  assert.equal(ui.cleaningQuotePricesConfirmed(items, [0, 1], [0, 1]), true);
  assert.equal(ui.cleaningQuotePricesConfirmed(items, [0, 1], [0]), false);
  assert.equal(ui.cleaningQuotePricesConfirmed([{ unitPrice: 0 }], [0], [0]), false);
  assert.equal(ui.cleaningQuotePricesConfirmed([], [0], [0]), false);
  const app = read('desktop-crm/src/app.js');
  assert.match(app, /data-cleaning-quote-price-confirm=/u);
  assert.match(app, /confirmedPriceIndices = \[\]/u);
  assert.match(app, /if \(!cleaningQuotePricesConfirmed\(quote\)\) return showToast/u);
  assert.match(app, /!cleaningQuotePricesConfirmed\(quote\) \? " disabled"/u);
});

test('cleaning partner search uses registered CRM fields and reports no invented recommendation metrics', () => {
  const ui = require('../src/cleaning-center-ui');
  const partner = { id: 'vendor-1', name: '늘봄 <케어>', region: '원주시', serviceText: '청소 · 입주 청소', phone: '010-1111-2222' };
  const html = ui.render({ cleaningPartners: [partner], orders: [], ordersLoaded: true, reportsLoaded: true, asOf: '2026-09-28' });
  assert.match(html, /청소 협력업체 검색/u);
  assert.match(html, /늘봄 &lt;케어&gt;/u);
  assert.match(html, /data-cleaning-partner-filter="region"/u);
  assert.match(html, /data-cleaning-partner-filter="service"/u);
  assert.match(html, /추천 순위·수락률·평점·가격·실시간 가능 여부는 CRM에 근거 자료가 없어 표시하지 않습니다/u);
  assert.equal(ui.matchesCleaningPartnerFilter(partner, { region: '원주', service: 'move_in_cleaning', query: '1111' }), true);
  assert.equal(ui.matchesCleaningPartnerFilter(partner, { region: '서울', service: 'all', query: '' }), false);
  assert.equal(ui.matchesCleaningPartnerFilter(partner, { region: '', service: 'stair_cleaning', query: '' }), false);
  const app = read('desktop-crm/src/app.js');
  assert.match(app, /cleaningPartners: allPartnerVendorRows\(\)\.filter/u);
  assert.match(app, /applyCleaningPartnerFilters\(\)/u);
  assert.match(app, /matchesCleaningPartnerFilter/u);
});

test('dispatch control tower derives assignment and delay counts from canonical cleaning orders', () => {
  const ui = require('../src/cleaning-center-ui');
  const data = {
    ordersLoaded: true,
    asOf: '2026-09-28',
    ordersHasMore: false,
    orders: [
      { id: 'waiting', title: '입주 청소', status: 'approval_pending', desiredDate: '2026-09-29', serviceType: 'move_in_cleaning', buildingAddress: '강원도 원주시 무실동', relatedWorkOrders: [] },
      { id: 'assigned', title: '계단 청소', status: 'scheduled', desiredDate: '2026-09-28', serviceType: 'stair_cleaning', buildingAddress: '강원도 원주시 단계동', relatedWorkOrders: [{ id: 'work-1', assigneeName: '홍길동', dueDate: '2026-09-28', status: 'assigned' }] },
      { id: 'overdue', title: '공용부 청소', status: 'in_progress', desiredDate: '2026-09-27', serviceType: 'common_cleaning', buildingAddress: '서울특별시 강남구 역삼동', relatedWorkOrders: [{ id: 'work-2', assigneeName: '담당자 미배정', dueDate: '2026-09-27', status: 'assigned' }] },
      { id: 'done', title: '퇴실 청소', status: 'completed', desiredDate: '2026-09-28', history: [{ status: 'completed', changedAt: '2026-09-28T10:00:00+09:00' }] },
    ],
  };
  const summary = ui.summarizeCleaningDispatch(data);
  assert.equal(summary.state, 'ready');
  assert.equal(summary.waitingAssignment, 2);
  assert.equal(summary.scheduledToday, 1);
  assert.equal(summary.completedToday, 1);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.jobs.length, 3);
  assert.equal(summary.regions[0].region, '원주시');
  assert.equal(ui.matchesCleaningDispatchFilter(data.orders[1], { region: '원주', service: 'stair_cleaning', date: 'today', status: 'assigned' }, '2026-09-28'), true);
  assert.equal(ui.matchesCleaningDispatchFilter(data.orders[0], { region: '', service: 'all', date: 'all', status: 'assigned' }, '2026-09-28'), false);
  const html = ui.render({ ...data, reportsLoaded: true, canCreateWorkOrders: true, canManageDispatch: true });
  assert.match(html, /DISPATCH CONTROL TOWER/u);
  assert.match(html, /배정 대기/u);
  assert.match(html, /건물 좌표가 없어 지도 핀/u);
  assert.match(html, /data-cleaning-view="workOrders"/u);
  assert.match(html, /data-action="create-cleaning-work-order" data-order-id="waiting"/u);
  assert.match(html, /data-action="create-cleaning-partner-offer" data-order-id="waiting">배차·지연 이력/u);
  assert.doesNotMatch(html, /수락률\s+\d/u);
  const readOnlyHtml = ui.render({ ...data, reportsLoaded: true });
  assert.doesNotMatch(readOnlyHtml, /data-action="create-cleaning-work-order"/u);
  assert.doesNotMatch(readOnlyHtml, /data-action="create-cleaning-partner-offer"/u);
  const pending = ui.render({ ordersLoading: true, reportsLoaded: true });
  assert.match(pending, /배차 현황을 숨겼습니다|주문을 불러오는 중입니다/u);
  assert.match(pending, /<strong>—<small>건<\/small><\/strong>/u);
  const app = read('desktop-crm/src/app.js');
  assert.match(app, /function applyCleaningDispatchFilters\(\)/u);
  assert.match(app, /matchesCleaningDispatchFilter/u);
  assert.match(app, /data-cleaning-dispatch-filter="region"/u);
});
