const test = require('node:test');
const assert = require('node:assert/strict');
const CleaningUI = require('../src/cleaning-center-ui');

test('cleaning analytics summarizes canonical order status, service and region with confirmed ledger totals', () => {
  const summary = CleaningUI.summarizeCleaningAnalytics({
    ordersLoaded: true,
    ordersHasMore: false,
    ordersUpdatedAt: Date.UTC(2026, 8, 28),
    asOf: '2026-09-28',
    billingLoaded: true,
    orders: [
      { id: 'a', status: 'completed', serviceType: 'move_in_cleaning', buildingAddress: '서울특별시 강남구 역삼동', createdAt: '2026-09-27T02:00:00Z' },
      { id: 'b', status: 'scheduled', serviceType: 'move_in_cleaning', buildingAddress: '서울특별시 강남구 논현동', createdAt: '2026-09-03T03:00:00Z' },
      { id: 'c', status: 'cancelled', serviceType: 'common_cleaning', buildingAddress: '경기도 성남시 분당구', createdAt: '2026-08-03T03:00:00Z' },
    ],
    cleaningPayments: [
      { orderId: 'a', invoiceId: 'inv-a', invoiceStatus: '확정', invoiceAmount: 120000, paidAmount: 100000 },
      { orderId: 'b', invoiceId: '', invoiceStatus: '', invoiceAmount: 0, paidAmount: 0 },
    ],
  });

  assert.equal(summary.state, 'ready');
  assert.equal(summary.totalOrders, 3);
  assert.equal(summary.byStatus.completed, 1);
  assert.equal(summary.byStatus.scheduled, 1);
  assert.equal(summary.byStatus.cancelled, 1);
  assert.equal(summary.services[0].count, 2);
  assert.equal(summary.months.find(item => item.month === '2026-09').count, 2);
  assert.equal(summary.payments.billed, 120000);
  assert.equal(summary.payments.received, 100000);
  assert.equal(summary.payments.unlinked, 1);
  assert.equal(summary.stages.find(item => item.key === 'completed').count, 1);
  assert.equal(summary.stages.find(item => item.key === 'consultation').count, null);
  assert.equal(summary.daily.find(item => item.date === '2026-09-27').orders, 1);
  assert.match(summary.scopeLabel, /확인된 청소 주문 3건/u);
});

test('cleaning analytics marks partial pages and unavailable billing instead of presenting them as totals', () => {
  const summary = CleaningUI.summarizeCleaningAnalytics({
    ordersLoaded: true,
    ordersHasMore: true,
    billingLoaded: false,
    orders: [{ id: 'a', status: 'received', createdAt: '2026-09-03T02:00:00Z' }],
    cleaningPayments: [],
  });

  assert.equal(summary.state, 'partial');
  assert.equal(summary.totalOrders, 1);
  assert.match(summary.scopeLabel, /전체 주문 중 일부/u);
  assert.equal(summary.payments.state, 'loading');
  assert.equal(summary.payments.billed, 0);
  assert.equal(summary.months.length, 0, 'month series is withheld until a valid date scope is supplied');
});

test('cleaning analytics renderer labels current status distribution and offers pagination for partial data', () => {
  const markup = CleaningUI.renderCleaningAnalytics({
    ordersLoaded: true,
    ordersHasMore: true,
    billingLoaded: true,
    orders: [{ id: 'a', status: 'received', createdAt: '2026-09-03T02:00:00Z' }],
    cleaningPayments: [],
  });

  assert.match(markup, /주문 이후 진행 현황/u);
  assert.match(markup, /일별 주문 수와 작업 결과 수/u);
  assert.match(markup, /지역별 실적/u);
  assert.match(markup, /파트너 평점·공급가 데이터 미연결/u);
  assert.match(markup, /문의부터 주문까지의 전환율 자료가 없습니다/u);
  assert.match(markup, /이전 주문 더 불러오기/u);
  assert.match(markup, /불러온 주문 범위/u);
  assert.match(markup, /고객 결제 총액·파트너 공급가·인건비·환불을 주문에 연결하는 자료가 부족해 GMV, 원가, 공헌이익은 계산하지 않습니다/u);
});

test('cleaning analytics is reachable from the Cleaning Center and loads more canonical orders on demand', () => {
  const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/app.js'), 'utf8');
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/index.html'), 'utf8');
  assert.match(app, /cleaningAnalytics:\s*\[/u);
  assert.match(app, /currentView === "cleaningAnalytics"\) renderCleaningAnalytics\(\)/u);
  assert.match(app, /\[data-cleaning-analytics-load-more\][\s\S]*?loadMoreCleaningOrders\(\)/u);
  assert.match(app, /!cleaningBillingState\.loaded && !cleaningBillingState\.loading && !cleaningBillingState\.error\) void loadCleaningBillingLedger\(\)/u);
  assert.match(html, /cleaning-center-ui\.js[\s\S]*?app\.js/u);
});

test('cleaning analytics ledger adapter requires an exact order link and same-building one-off cleaning contract', () => {
  const rows = CleaningUI.buildCleaningPayments({
    orders: [{ id: 'order-1', buildingId: 'building-1', title: '입주 청소', quoteSummary: { status: 'admin_approved', totalAmount: 120000 } }],
    contracts: [
      { id: 'cleaning-contract', buildingId: 'building-1', billingCycle: '건별', cleaningEligible: true },
      { id: 'wrong-building', buildingId: 'building-2', billingCycle: '건별', cleaningEligible: true },
      { id: 'recurring-cleaning', buildingId: 'building-1', billingCycle: '월별', cleaningEligible: true },
    ],
    ledger: {
      invoices: [
        { id: 'linked', contractId: 'cleaning-contract', occurrenceId: 'order-1', amount: 120000, status: 'approved' },
        { id: 'wrong-building-invoice', contractId: 'wrong-building', occurrenceId: 'order-1', amount: 70000, status: 'approved' },
        { id: 'recurring-invoice', contractId: 'recurring-cleaning', occurrenceId: 'order-1', amount: 30000, status: 'approved' },
        { id: 'draft-invoice', contractId: 'cleaning-contract', occurrenceId: 'order-1', amount: 90000, status: 'draft' },
      ],
      receipts: [{ id: 'receipt', invoiceId: 'linked', amount: 50000, status: 'approved' }],
    },
    invoicePaymentState: () => '부분입금',
  });
  assert.deepEqual(rows.map(row => row.invoiceId), ['linked', 'draft-invoice']);
  assert.equal(rows[0].paidAmount, 50000);
  assert.equal(rows[0].invoiceStatus, '확정');
  assert.equal(rows[1].invoiceStatus, '초안');
});
