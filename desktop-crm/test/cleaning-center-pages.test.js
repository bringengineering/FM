'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pages = require('../src/cleaning-center-pages');

const root = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const expectedReferences = [
  ['01', 'cleaningCenter', '통합 운영 대시보드'],
  ['02', 'cleaningCti', 'CTI 상담센터'],
  ['03', 'cleaningLeads', '신규문의'],
  ['04', 'cleaningCustomer360', '고객 상세'],
  ['05', 'cleaningQuoteCalculator', '견적 계산기'],
  ['06', 'cleaningOrderDetail', '주문 상세'],
  ['07', 'cleaningPartnerSearch', '파트너 검색 / 추천'],
  ['08', 'cleaningDispatchTower', 'Dispatch Control Tower'],
  ['09', 'cleaningScheduleMap', '일정·지도 관제'],
  ['10', 'cleaningWorkOrder', 'Work Order'],
  ['11', 'cleaningPhotoReview', '사진 검수센터'],
  ['12', 'cleaningSupportCenter', 'CS / AS Center'],
  ['13', 'cleaningPayments', '결제 · 정산'],
  ['14', 'cleaningPartnerManagement', 'Partner Management'],
  ['15', 'cleaningAnalytics', 'Analytics'],
  ['16', 'cleaningPartnerApp', 'BRING Partner App'],
  ['17', 'cleaningBusinessFlow', '전체 Business Flow'],
  ['18', 'cleaningArchitecture', 'System Architecture'],
  ['19', 'cleaningDataModel', 'Database / Data Model'],
  ['20', 'cleaningPartnerOffer', '파트너 작업제안'],
  ['21', 'cleaningPartnerDecline', '업체 거절 처리'],
  ['22', 'cleaningPartnerNoResponse', '무응답 처리'],
  ['23', 'cleaningReassignment', '재배정'],
  ['24', 'cleaningOrderCancellation', '주문 취소'],
  ['25', 'cleaningPartialRefund', '부분 환불'],
  ['26', 'cleaningRework', '재작업 요청'],
  ['27', 'cleaningPartnerRegistration', '신규 파트너 등록'],
  ['28', 'cleaningPricingPolicy', '가격정책 설정'],
  ['29', 'cleaningStaffPermissions', '직원 권한관리'],
  ['30', 'cleaningCustomerMessage', '고객 문자 발송'],
  ['31', 'cleaningConsultationBooking', '상담 예약 등록'],
  ['32', 'cleaningExtraCharge', '추가금 승인 요청'],
  ['33', 'cleaningDelayNoShow', '지연 · 노쇼 대응'],
  ['34', 'cleaningSettlementPayout', '정산 확정 · 지급'],
];

test('the Cleaning Center registry defines every supplied screen exactly once', () => {
  assert.equal(pages.SCREENS.length, 34);
  assert.deepEqual(pages.SCREENS.map(({ reference }) => reference), expectedReferences.map(([reference]) => reference));
  assert.deepEqual(pages.SCREENS.map(({ view, title }) => [view, title]), expectedReferences.map(([, view, title]) => [view, title]));
  assert.equal(new Set(pages.SCREENS.map(({ view }) => view)).size, 34);
  assert.ok(pages.SCREEN_GROUPS.length >= 6);
  assert.ok(pages.SCREENS.every(({ group, kind }) => pages.SCREEN_GROUPS.some(item => item.id === group) && typeof kind === 'string'));
});

test('the Cleaning Center sidebar exposes all 34 pages as one flat, ordered list', () => {
  const html = read('desktop-crm/src/index.html');
  const folder = html.slice(html.indexOf('data-nav-folder="cleaning-center"'), html.indexOf('data-view="settings"', html.indexOf('data-nav-folder="cleaning-center"')));
  const navigation = pages.renderNavigation();
  const navReferences = [...navigation.matchAll(/data-cleaning-screen="(\d{2})"/gu)].map(match => match[1]);
  assert.deepEqual(navReferences, expectedReferences.map(([reference]) => reference));
  assert.match(folder, /data-cleaning-pages-nav/u);
  assert.doesNotMatch(navigation, /data-cleaning-nav-group|data-cleaning-group-toggle/u);
  assert.equal((navigation.match(/class="nav-item nav-child/g) || []).length, 34);
  for (const [, view] of expectedReferences) assert.ok(navigation.includes(`data-view="${view}"`), `${view} must be navigable from Cleaning Center`);
  assert.equal((navigation.match(/aria-label="\d{2} /gu) || []).length, 34, 'every page has a descriptive accessible name');
});

test('Cleaning Center routes have metadata and are deep-link allowlisted', () => {
  const app = read('desktop-crm/src/app.js');
  for (const [, view] of expectedReferences) {
    assert.ok(pages.viewMeta()[view], `${view} needs page metadata`);
    assert.ok(navigationHasRoute(view), `${view} needs a menu route`);
  }
  assert.match(app, /Object\.assign\(viewMeta, window\.BringCleaningCenterPages\.viewMeta\(\)\)/u);
  assert.match(app, /screenByView\(query\.get\("view"\)\)/u);
});

function navigationHasRoute(view) { return pages.renderNavigation().includes(`data-view="${view}"`); }

test('reference #01 is a focused home dashboard and does not include other module panels', () => {
  const ui = require('../src/cleaning-center-ui');
  const home = ui.renderCleaningDashboard({ ordersLoaded: true, orders: [], reportsLoaded: true });
  assert.match(home, /통합 운영 대시보드|오늘의 청소 운영 현황/u);
  for (const otherPanel of ['청소 협력업체 검색', '일정·지도 관제', '결제·정산', 'CS\/AS']) {
    assert.doesNotMatch(home, new RegExp(otherPanel, 'u'));
  }
});

test('each non-dashboard Cleaning Center route renders one dedicated screen body', () => {
  const ui = require('../src/cleaning-center-ui');
  for (const screen of pages.SCREENS.filter(item => !['dashboard', 'cti', 'analytics'].includes(item.kind))) {
    const html = ui.render({
      view: screen.view,
      pageKind: screen.kind,
      reference: screen.reference,
      pageTitle: screen.title,
      orders: [],
      cleaningCustomers: [],
      cleaningPartners: [],
      ordersLoaded: true,
      reportsLoaded: true,
    });
    assert.match(html, new RegExp(`data-cleaning-page="${screen.view}"`, 'u'), `${screen.reference} ${screen.title} has a dedicated page root`);
    assert.match(html, new RegExp(screen.kind === 'pricing' ? `data-cleaning-reference="${screen.reference}"` : `SCREEN ${screen.reference}`, 'u'), `${screen.reference} has its reference number`);
    assert.doesNotMatch(html, /cleaning-center-quick-actions|cleaning-link-grid/u, `${screen.reference} must not render the all-in-one hub`);
  }
});

test('pricing and permissions reference pages show their full CRM-backed working surfaces', () => {
  const ui = require('../src/cleaning-center-ui');
  const pricing = ui.render({
    view: 'cleaningPricingPolicy', pageKind: 'pricing', reference: '28', pageTitle: '가격정책 설정',
    policies: [], today: '2026-09-30', canManagePricingPolicies: true,
  });
  assert.match(pricing, /data-cleaning-pricing-policy-form/u);
  assert.match(pricing, /18평 이하/u);
  assert.match(pricing, /베란다 청소/u);
  assert.match(pricing, /data-cleaning-pricing-save="published"/u);
  assert.doesNotMatch(pricing, /가격정책 열기/u);
  const baseTable = pricing.match(/<table class="cleaning-pricing-table">([\s\S]*?)<\/table>/u)?.[1] || '';
  assert.equal((baseTable.match(/<tr>/gu) || []).length, 4, 'base table has one header row and three housing rows');
  assert.doesNotMatch(baseTable, /<\/tr><\/td>/u, 'each housing price stays in its own table cell');
  assert.match(pricing, /cleaning-pricing-policy-reference/u, 'reference screen uses the compact policy layout');
  assert.match(pricing, /적용 상태/u);
  assert.match(pricing, /적용 시작일/u);
  assert.match(pricing, /변경 취소/u);
  assert.match(pricing, /새 가격표 적용/u);
  assert.match(pricing, /서비스 항목/u);
  assert.doesNotMatch(pricing, /서비스 ID/u, 'internal service IDs are not shown in the screen');
  assert.match(pricing, /value="240,000"/u, 'amounts use the reference screen currency formatting');
  assert.doesNotMatch(pricing, /SCREEN 28/u, 'the page does not add a duplicate generic heading above the policy dialog');

  const permissions = ui.render({
    view: 'cleaningStaffPermissions', pageKind: 'permissions', reference: '29', pageTitle: '직원 권한관리',
    securityAccessMarkup: '<section class="security-panel"><h3>서버에서 실제 적용되는 권한</h3><table class="permission-table"><tr><td>관리자</td></tr></table></section>',
  });
  assert.match(permissions, /서버에서 실제 적용되는 권한/u);
  assert.match(permissions, /permission-table/u);
  assert.doesNotMatch(permissions, /CRM 권한 설정 열기/u);

  const settlement = ui.render({
    view: 'cleaningSettlementPayout', pageKind: 'settlement', reference: '34', pageTitle: '정산 확정 · 지급',
    settlementReview: { fromDate: '2026-09-21', toDate: '2026-09-27', partners: [{ vendorId: 'vendor-1', vendorName: 'A클린', completedWorkCount: 3, grossSupplierAmount: 420000, checks: {} }] },
    selectedSettlementVendorId: 'vendor-1',
  });
  assert.match(settlement, /지급 전 확인 항목/u);
  assert.match(settlement, /지급 계좌 확인 필요/u);
  assert.match(settlement, /정산 확정·지급/u);
  assert.match(settlement, /disabled aria-disabled="true"/u);
});

test('the Cleaning Center navigation remains scrollable within the sidebar', () => {
  const styles = read('desktop-crm/src/styles.css');
  const app = read('desktop-crm/src/app.js');
  assert.match(styles, /\.cleaning-center-navigation\{[^}]*max-height:[^;}]+;[^}]*overflow-y:auto/su);
  assert.match(styles, /\.cleaning-center-navigation>\.nav-item\.nav-child/su);
  assert.match(app, /cleaningNavItem\?\.scrollIntoView\(\{ block: "nearest" \}\)/u);
});

test('reference #01 shows linked order rows with the owner and a CRM detail action', () => {
  const ui = require('../src/cleaning-center-ui');
  const home = ui.renderCleaningDashboard({
    ordersLoaded: true, reportsLoaded: true, asOf: '2026-09-30', nowMs: Date.parse('2026-09-30T09:00:00+09:00'),
    orders: [{
      id: 'BR-260930-00001', title: '입주청소 24평', customerName: '김민수', customerPhone: '010-1234-5678',
      buildingAddress: '강원특별자치도 원주시 무실로 123', desiredDate: '2026-10-01', status: 'scheduled',
      statusLabel: '일정 확정', assigneeName: '김현진', sourceChannel: 'phone',
    }],
  });
  assert.match(home, /오늘의 진행 현황/u);
  assert.match(home, /주문번호/u);
  assert.match(home, /BR-260930-00001/u);
  assert.match(home, /김민수/u);
  assert.match(home, /김현진/u);
  assert.match(home, /data-action="view-cleaning-order-details" data-order-id="BR-260930-00001"/u);
  const styles = read('desktop-crm/src/cleaning-center.css');
  assert.match(styles, /\.cleaning-dashboard-order-table tbody tr\{display:table-row\}/u);
});

test('reference #04 renders one customer CRM profile with linked activity and order records', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({
    view: 'cleaningCustomer360', pageKind: 'customer', reference: '04', pageTitle: '고객 상세',
    cleaningCustomers: [{ id: 'customer-1', customerNo: 'C-001', name: '김민수', phone: '010-1234-5678', createdAt: '2024-09-12', type: '개인', buildingIds: ['building-1'] }, { id: 'customer-2', name: '이서연', phone: '010-2222-3333' }],
    cleaning360CustomerId: 'customer-1',
    cleaningBuildings: [{ id: 'building-1', ownerCustomerId: 'customer-1', name: '무실동 브링아파트', roadAddress: '원주시 무실로 123', buildingType: '아파트', areaPyeong: 24 }],
    orders: [{ id: 'BR-001', customerId: 'customer-1', buildingId: 'building-1', title: '입주청소 24평', status: 'completed', statusLabel: '작업완료', desiredDate: '2025-09-26' }],
    cleaning360Activities: [{ id: 'activity-1', customerId: 'customer-1', type: '전화 상담', occurredAt: '2025-09-26T14:32:00+09:00', summary: '입주청소 견적 문의', owner: '이지은' }],
    cleaning360Cases: [], cleaningPayments: [{ orderId: 'BR-001', orderTitle: '입주청소 24평', invoiceId: 'invoice-1', invoiceStatus: '확정', invoiceAmount: 240000, paidAmount: 240000 }],
    billingLoaded: true,
  });
  assert.match(html, /cleaning-customer360-page/u);
  assert.match(html, /김민수/u);
  assert.match(html, /상담 이력/u);
  assert.match(html, /입주청소 견적 문의/u);
  assert.match(html, /무실동 브링아파트/u);
  assert.match(html, /data-action="view-cleaning-order-details" data-order-id="BR-001"/u);
  assert.match(html, /data-cleaning-customer-select/u);
});

test('references #05 and #06 render a quote calculator and linked order detail page', () => {
  const ui = require('../src/cleaning-center-ui');
  const common = {
    orders: [{ id: 'BR-006', customerId: 'customer-1', buildingId: 'building-1', customerName: '김민수', customerPhone: '010-1234-5678', buildingAddress: '원주시 무실로 123', buildingType: '아파트', areaPyeong: 24, title: '입주청소 24평', serviceLabel: '입주청소', status: 'scheduled', statusLabel: '일정 확정', desiredDate: '2026-10-03', relatedWorkOrders: [{ id: 'WO-006', title: '현장 체크리스트', statusLabel: '배정 대기' }], relatedReports: [] }],
    ordersLoaded: true, canWrite: true, pricingLoading: false,
    pricingPolicies: [{ policy: { policyId: 'p-1', name: '원주 가격표', region: '원주시', effectiveFrom: '2026-10-01', publication: 'published', basePrices: { apartment: [180000, 240000, 280000, 320000, 360000], villa: [160000, 220000, 260000, 300000, 340000], detached: [200000, 260000, 320000, 360000, 400000] }, addOns: [{ id: 'balcony', name: '베란다 청소', amount: 20000 }], discountCaps: { promotion: 50000, membership: 30000 } } }],
  };
  const quote = ui.render({ ...common, view: 'cleaningQuoteCalculator', pageKind: 'quotes', reference: '05', pageTitle: '견적 계산기' });
  assert.match(quote, /cleaning-quote-calculator-page/u);
  assert.match(quote, /data-cleaning-quote-order-select/u);
  assert.match(quote, /240,000원/u);
  assert.match(quote, /베란다 청소/u);
  assert.match(quote, /data-action="manage-cleaning-quote" data-order-id="BR-006"/u);
  const detail = ui.render({ ...common, view: 'cleaningOrderDetail', pageKind: 'order-detail', reference: '06', pageTitle: '주문 상세' });
  assert.match(detail, /cleaning-order-detail-page/u);
  assert.match(detail, /data-cleaning-order-detail-select/u);
  assert.match(detail, /BR-006/u);
  assert.match(detail, /현장 체크리스트/u);
  assert.match(detail, /data-action="view-cleaning-order-details" data-order-id="BR-006"/u);
});

test('references #10 and #11 show canonical work orders and report review evidence', () => {
  const ui = require('../src/cleaning-center-ui');
  const order = {
    id: 'order-field-1', title: '입주청소 24평', customerName: '김민수', customerPhone: '010-1234-5678',
    buildingName: '무실동 브링아파트', buildingAddress: '원주시 무실로 123', desiredDate: '2026-10-03',
    status: 'in_progress', statusLabel: '작업 중', relatedWorkOrders: [
      { id: 'work-field-1', title: '입주청소 현장 작업', status: 'in_progress', statusLabel: '진행 중', progress: 60, assigneeName: '김민지', dueDate: '2026-10-03' },
    ], relatedReports: [],
  };
  const work = ui.render({ view: 'cleaningWorkOrder', pageKind: 'work-order', reference: '10', pageTitle: 'Work Order', orders: [order], canCreateWorkOrders: true });
  assert.match(work, /cleaning-work-order-queue/u);
  assert.match(work, /김민지/u);
  assert.match(work, /data-action="open-cleaning-work-order" data-record-id="work-field-1"/u);

  const reviewOrder = { ...order, status: 'review_pending', statusLabel: '검수 대기', relatedReports: [
    { id: 'report-field-1', title: '입주청소 결과보고', workDate: '2026-10-03', photoCount: 4, checklistSummary: { done: 8, partial: 1, skipped: 0, progress: 89 } },
  ] };
  const review = ui.render({ view: 'cleaningPhotoReview', pageKind: 'photo-review', reference: '11', pageTitle: '사진 검수센터', orders: [reviewOrder], reportsLoaded: true });
  assert.match(review, /cleaning-photo-review-queue/u);
  assert.match(review, /증거 사진 4장/u);
  assert.match(review, /체크리스트 8\/9/u);
  assert.match(review, /data-action="open-cleaning-report" data-record-id="report-field-1"/u);
});

test('payment and payout details reflow inside the narrow settlement panel', () => {
  const styles = read('desktop-crm/src/cleaning-center.css');
  assert.match(styles, /\.cleaning-settlement-unavailable\{container-type:inline-size\}/u);
  assert.match(styles, /@container \(max-width:540px\)\{\.cleaning-settlement-review-grid\{grid-template-columns:1fr\}/u);
  assert.match(styles, /\.cleaning-payment-workspaces\{display:grid;grid-template-columns:minmax\(0,1\.6fr\) minmax\(300px,\.85fr\)/u);
});

test('the selected page is the only highlighted Cleaning Center destination', () => {
  const navigation = pages.renderNavigation('cleaningDelayNoShow');
  const activeReferences = [...navigation.matchAll(/class="nav-item nav-child active"[^>]*data-cleaning-screen="(\d{2})"/gu)].map(match => match[1]);
  assert.deepEqual(activeReferences, ['33']);
});

test('the Electron smoke checks the real flat navigation and each selected route', () => {
  const main = read('desktop-crm/src/main.js');
  assert.match(main, /flatNavigationWorks/u);
  assert.match(main, /selectedNavVisible/u);
  assert.match(main, /cleaningNavigation\?\.querySelectorAll\(':scope > \[data-cleaning-screen\]'\)/u);
});
test('extra-charge page only shows in-progress orders and opens the extra-charge workflow', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({
    view: 'cleaningExtraCharge', pageKind: 'extra-charge', reference: '32', pageTitle: '추가금 승인 요청',
    orders: [
      { id: 'BR-001', status: 'in_progress', title: '입주청소 진행 중' },
      { id: 'BR-002', status: 'scheduled', title: '예정 주문' },
    ], ordersLoaded: true, canWrite: true,
  });
  assert.match(html, /현장 작업 진행 중인 주문/u);
  assert.match(html, /BR-001/u);
  assert.doesNotMatch(html, /BR-002/u);
  assert.match(html, /data-action="manage-cleaning-extra-charge"/u);
});

test('delay response page isolates scheduled and active cleaning orders', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({
    view: 'cleaningDelayNoShow', pageKind: 'delay', reference: '33', pageTitle: '지연 · 노쇼 대응',
    orders: [
      { id: 'BR-101', status: 'scheduled', title: '도착 확인 대상' },
      { id: 'BR-102', status: 'in_progress', title: '작업 진행 대상' },
      { id: 'BR-103', status: 'completed', title: '완료된 주문' },
    ], ordersLoaded: true, canWrite: true,
  });
  assert.match(html, /예정 시간 또는 현장 진행 중인 주문/u);
  assert.match(html, /BR-101/u);
  assert.match(html, /BR-102/u);
  assert.doesNotMatch(html, /BR-103/u);
  assert.match(html, /data-action="open-cleaning-delay-response"/u);
});
test('lead queue reference screen renders the channel rail and operational intake table', () => {
  const ui = require('../src/cleaning-center-ui');
  const html = ui.render({
    view: 'cleaningLeads', pageKind: 'order-queue', reference: '03', pageTitle: '신규문의 / Lead Queue',
    orders: [
      { id: 'BR-260926-00128', title: '입주청소 24평', customerName: '김민수', customerPhone: '010-1234-5678', serviceType: 'move_in_cleaning', buildingAddress: '강원특별자치도 원주시 무실로 123', desiredDate: '2026-09-29', createdAt: '2026-09-26T10:18:00+09:00', status: 'received', sourceChannel: 'phone' },
      { id: 'BR-260926-00127', title: '이사청소 32평', customerName: '이지은', customerPhone: '010-2345-6789', serviceType: 'move_out_cleaning', buildingAddress: '서울특별시 강남구', desiredDate: '2026-09-30', createdAt: '2026-09-26T10:05:00+09:00', status: 'reviewing', sourceChannel: 'naver', assigneeName: '박수빈' },
    ], ordersLoaded: true, canWrite: true, nowMs: Date.parse('2026-09-26T10:35:00+09:00'),
  });
  for (const header of ['유입시각', '고객명', '연락처', '유입채널', '서비스', '지역', '희망일', '주문번호', '담당자', 'SLA', '상태', '작업']) {
    assert.ok(html.includes(header), `lead queue is missing ${header}`);
  }
  assert.match(html, /data-cleaning-lead-table/u);
  assert.match(html, /BR-260926-00128/u);
  assert.match(html, /김민수/u);
  assert.match(html, /naver/u);
});

test('flow, architecture and data model references render independent diagrams and structures', () => {
  const ui = require('../src/cleaning-center-ui');
  const render = (view, pageKind, reference, pageTitle) => ui.render({ view, pageKind, reference, pageTitle });
  const flow = render('cleaningBusinessFlow', 'documentation-flow', '17', '전체 Business Flow');
  assert.match(flow, /광고·제휴/u);
  assert.match(flow, /CTI\s*·\s*상담/u);
  assert.match(flow, /단계별 상세 정보/u);
  assert.match(flow, /예외 처리 흐름/u);
  assert.match(flow, /재배정/u);
  const architecture = render('cleaningArchitecture', 'documentation-architecture', '18', '시스템 아키텍처');
  assert.match(architecture, /Input Channel/u);
  assert.match(architecture, /Dispatch Engine/u);
  assert.match(architecture, /External Integration/u);
  assert.match(architecture, /SMS/u);
  const model = render('cleaningDataModel', 'documentation-data', '19', 'Database / Data Model');
  assert.match(model, /주요 엔티티 관계도/u);
  assert.match(model, /고객\s*\(Customer\)/u);
  assert.match(model, /작업증빙\s*\(Evidence\)/u);
  assert.match(model, /주요 엔티티 정의 및 필드/u);
  assert.match(model, /1:N/u);
});

test('visual gallery injects labeled Cleaning Center data only in isolated demo mode', () => {
  const app = read('desktop-crm/src/app.js');
  const main = read('desktop-crm/src/main.js');
  assert.match(app, /setCleaningOrdersForTest:\s*data\s*=>\s*\{\s*if\s*\(new URLSearchParams\(location\.search\)\.get\("demo"\) !== "1"/u);
  assert.match(app, /setCleaningOrdersForTest:[\s\S]{0,3000}fixtureOnly:\s*true/u);
  assert.match(app, /cleaningOrderState\.loaded\s*=\s*true/u);
  assert.match(app, /setCleaningOrdersForTest:[\s\S]{0,3000}renderCleaningCenter\(\)/u);
  assert.ok(main.indexOf('cleaning-center-pages-gallery') < main.indexOf('화면 검수용 샘플 · CRM 저장/운영 API 호출 없음'));
  assert.match(main, /window\.__crmTest\.setCleaningOrdersForTest\(\{ orders: previewOrders, workOrders: previewWorkOrders, reports: previewReports,[\s\S]{0,240}settlementReview: previewSettlement \}\)/u);
  assert.match(main, /previewData\?\.fixtureOnly === true && previewData\.orderCount === 12/u);
  assert.match(main, /fixtureOnly:\s*true/u);
});
