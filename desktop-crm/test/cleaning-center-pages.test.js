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
  ['04', 'cleaningCustomer360', 'Customer 360'],
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

test('the Cleaning Center sidebar has one destination for each registry screen', () => {
  const html = read('desktop-crm/src/index.html');
  const folder = html.slice(html.indexOf('data-nav-folder="cleaning-center"'), html.indexOf('data-view="settings"', html.indexOf('data-nav-folder="cleaning-center"')));
  const navigation = pages.renderNavigation();
  const navReferences = [...navigation.matchAll(/data-cleaning-screen="(\d{2})"/gu)].map(match => match[1]).sort();
  assert.deepEqual(navReferences, expectedReferences.map(([reference]) => reference).sort());
  assert.match(folder, /data-cleaning-pages-nav/u);
  for (const [, view] of expectedReferences) assert.ok(navigation.includes(`data-view="${view}"`), `${view} must be navigable from Cleaning Center`);
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
    assert.match(html, new RegExp(`SCREEN ${screen.reference}`, 'u'), `${screen.reference} has its reference number`);
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

test('cleaning sidebar group toggles are handled independently from top-level folders', () => {
  const app = read('desktop-crm/src/app.js');
  const navigation = pages.renderNavigation();
  assert.match(navigation, /data-cleaning-group-toggle="overview"/u);
  assert.match(app, /closest\("\[data-cleaning-group-toggle\]"\)/u);
  assert.match(app, /group\.classList\.toggle\("is-open", open\)/u);
});
