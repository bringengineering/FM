const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core');
const CleaningUI = require('../src/cleaning-center-ui');

test('cleaning partner profiles normalize to a bounded canonical shape and preserve legacy vendors', () => {
  const vendor = Core.normalizePartnerVendor({
    id: 'vendor-1', industry: '청소', service: '입주 청소', region: '원주',
    cleaningProfile: {
      serviceTypes: ['move_in_cleaning', 'move_in_cleaning', 'not_a_service'],
      serviceRegions: [' 원주시 ', '', '원주시', '강릉시'],
      onboardingStatus: 'submitted', availabilityStatus: 'available', availabilityCheckedAt: '2026-09-28',
      complianceStatus: 'verified', complianceCheckedAt: '2026-09-27', note: ' 확인 완료 ', unexpected: 'discard me',
    },
  });
  assert.deepEqual(vendor.cleaningProfile, {
    serviceTypes: ['move_in_cleaning'], serviceRegions: ['원주시', '강릉시'], onboardingStatus: 'submitted',
    availabilityStatus: 'available', availabilityCheckedAt: '2026-09-28', complianceStatus: 'verified',
    complianceCheckedAt: '2026-09-27', note: '확인 완료',
  });
  assert.equal(Object.hasOwn(Core.normalizePartnerVendor({ id: 'legacy-vendor', industry: '청소' }), 'cleaningProfile'), false);
});

test('cleaning partner profile uses safe defaults for invalid statuses, dates, and oversized values', () => {
  const profile = Core.normalizeCleaningPartnerProfile({
    serviceTypes: ['stair_cleaning', 'unknown'], serviceRegions: ['x'.repeat(150), ' 서울 ', '서울'],
    onboardingStatus: 'approved by vendor', availabilityStatus: 'live', availabilityCheckedAt: 'yesterday',
    complianceStatus: 'verified without review', complianceCheckedAt: '2026-99-99', note: 'n'.repeat(700),
  });
  assert.deepEqual(profile, {
    serviceTypes: ['stair_cleaning'], serviceRegions: ['서울'], onboardingStatus: 'not_started',
    availabilityStatus: 'unknown', availabilityCheckedAt: '', complianceStatus: 'not_reviewed',
    complianceCheckedAt: '', note: 'n'.repeat(500),
  });
});

test('cleaning partner management summarizes registered workflow states and filters canonical vendor data', () => {
  const partners = [
    { id: 'vendor-1', name: '늘봄 케어', industry: '청소', region: '원주시', cleaningProfile: {
      serviceTypes: ['move_in_cleaning'], serviceRegions: ['원주시', '횡성군'], onboardingStatus: 'approved',
      availabilityStatus: 'available', complianceStatus: 'verified',
    } },
    { id: 'vendor-2', name: '한결 청소', industry: '청소', region: '춘천시', cleaningProfile: {
      serviceTypes: ['stair_cleaning'], serviceRegions: ['춘천시'], onboardingStatus: 'submitted',
      availabilityStatus: 'unknown', complianceStatus: 'pending',
    } },
    { id: 'vendor-3', name: '기존 업체', industry: '청소', region: '원주시', service: '계단 청소' },
  ];
  const summary = CleaningUI.summarizeCleaningPartnerManagement(partners);
  assert.deepEqual({ total: summary.total, onboarded: summary.onboarded, available: summary.available, unknownAvailability: summary.unknownAvailability, needsComplianceReview: summary.needsComplianceReview }, {
    total: 3, onboarded: 1, available: 1, unknownAvailability: 2, needsComplianceReview: 2,
  });
  assert.equal(CleaningUI.matchesCleaningPartnerManagementFilter(partners[0], { service: 'move_in_cleaning', region: '횡성', query: '' }), true);
  assert.equal(CleaningUI.matchesCleaningPartnerManagementFilter(partners[1], { service: 'move_in_cleaning', region: '', query: '' }), false);
  assert.equal(CleaningUI.matchesCleaningPartnerManagementFilter(partners[2], { service: 'stair_cleaning', region: '원주', query: '기존' }), true);
  assert.deepEqual(CleaningUI.cleaningPartnerCandidateFromVendor(partners[0], '010-1234-5678'), {
    id: 'vendor-1', name: '늘봄 케어', region: '원주시 · 횡성군', serviceText: '입주 청소', phone: '010-1234-5678',
  });
  assert.deepEqual(CleaningUI.cleaningPartnerCandidateFromVendor(partners[2], '010-0000-0000'), {
    id: 'vendor-3', name: '기존 업체', region: '원주시', serviceText: '청소 · 계단 청소', phone: '010-0000-0000',
  });
  const html = CleaningUI.renderCleaningPartnerManagement(partners);
  assert.match(html, /파트너 관리/u);
  assert.match(html, /늘봄 케어/u);
  assert.match(html, /담당자가 마지막으로 확인한 상태이며 실시간 정보가 아닙니다/u);
  assert.match(html, /data-cleaning-partner-profile-edit="vendor-1"/u);
});

test('shared CRM sanitization preserves only normalized cleaning profiles', () => {
  const store = Core.sanitizeSharedStore({ partnerVendors: [
    { id: 'cleaner-1', name: '청소 업체', industry: '청소', cleaningProfile: { onboardingStatus: 'approved', note: '확인', extraField: 'discard' } },
    { id: 'vendor-2', name: '일반 업체', industry: '전기', cleaningProfile: { onboardingStatus: 'approved' } },
  ] });
  assert.deepEqual(store.partnerVendors[0].cleaningProfile, Core.normalizeCleaningPartnerProfile({ onboardingStatus: 'approved', note: '확인' }));
  assert.equal(Object.hasOwn(store.partnerVendors[1], 'cleaningProfile'), false);
});

test('cleaning partner manager lays out a selectable vendor table beside a detail pane using recorded fields only', () => {
  const html = CleaningUI.renderCleaningPartnerManagement([
    { id: 'vendor-a', name: 'A클린', industry: '청소', region: '원주시', phone: '010-1111-2222', active: true,
      representativeName: '김대표', businessRegistrationNumber: '123-45-67890', email: 'a@example.com',
      cleaningProfile: { serviceTypes: ['move_in_cleaning'], serviceRegions: ['원주시'], onboardingStatus: 'approved', availabilityStatus: 'available', complianceStatus: 'verified' } },
    { id: 'vendor-b', name: 'B클린', industry: '청소', region: '횡성군', phone: '010-3333-4444', active: false,
      cleaningProfile: { serviceTypes: ['stair_cleaning'], serviceRegions: ['횡성군'], onboardingStatus: 'submitted', availabilityStatus: 'unknown', complianceStatus: 'pending' } },
  ], 'vendor-b');
  assert.match(html, /class="cleaning-partner-management-table"/u);
  assert.match(html, /파트너 데이터베이스/u);
  assert.match(html, /data-cleaning-partner-management-select="vendor-b"[^>]*aria-pressed="true"/u);
  assert.match(html, /data-cleaning-partner-management-details="vendor-b"/u);
  assert.match(html, /김대표/u);
  assert.match(html, /123-45-67890/u);
  assert.match(html, /팀·차량·장비 상세 자료 미등록/u);
  assert.match(html, /평점|완료율|수락률/u);
  assert.match(html, /자료 미연결/u);
});

test('cleaning partner manager selection switches the highlighted row and matching detail pane', () => {
  const fs = require('node:fs');
  const app = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  assert.match(app, /data-cleaning-partner-management-select[\s\S]*?data-cleaning-partner-management-details/u);
});

test('partner manager and Cleaning Center use canonical cleaning profiles for editing and search', () => {
  const fs = require('node:fs');
  const app = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  const ui = fs.readFileSync(require.resolve('../src/cleaning-center-ui.js'), 'utf8');
  assert.match(app, /partnerVendorIndustryFilter === "청소"[\s\S]*?renderCleaningPartnerManagement\(cleaningVendors\)/u);
  assert.match(app, /data-cleaning-partner-editor[\s\S]*?cleaningAvailabilityCheckedAt[\s\S]*?cleaningComplianceCheckedAt/u);
  assert.match(app, /item\.cleaningProfile = Core\.normalizeCleaningPartnerProfile/u);
  assert.match(app, /action: cleaningProfileChanged \? "청소 협력업체 프로필 수정"/u);
  assert.match(app, /if \(currentView === "partnerVendors"\) partnerVendorIndustryFilter = "청소"/u);
  assert.match(app, /cleaningPartnerCandidateFromVendor\(item, partnerPhoneText\(item\)\)/u);
  assert.match(ui, /profile\.serviceRegions\.join\(" · "\)/u);
  assert.match(ui, /담당자가 마지막으로 확인한 상태이며 실시간 정보가 아닙니다/u);
  assert.match(ui, /matchesCleaningPartnerManagementFilter/u);
});

test('partner manager can bind a verified app email and dispatch actions use the protected partner endpoint', () => {
  const fs = require('node:fs');
  const app = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  const remote = fs.readFileSync(require.resolve('../src/remote.js'), 'utf8');
  const html = CleaningUI.renderCleaningPartnerManagement([{ id: 'vendor-1', name: '늘봄 케어', industry: '청소' }]);
  assert.match(html, /data-cleaning-partner-account-bind="vendor-1"/u);
  assert.match(app, /cleaningPartnerAccountBindForm/u);
  assert.match(app, /api\.bindCleaningPartnerAccount/u);
  assert.match(app, /create-cleaning-partner-offer/u);
  assert.match(remote, /async bindCleaningPartnerAccount\(/u);
  assert.match(remote, /async createCleaningPartnerOffer\(/u);
  assert.match(remote, /cleaningPartnerApi/u);
});

test('dispatch status view presents persisted response and expiry states and limits reassignments to the server action', () => {
  const accepted = CleaningUI.renderCleaningPartnerDispatch({
    order: { id: 'order-1', title: '입주 청소', serviceLabel: '입주 청소', desiredDate: '2026-09-29', region: '원주시' },
    dispatch: { orderId: 'order-1', acceptedOfferId: 'offer-1', offers: [
      { id: 'offer-1', vendorId: 'vendor-1', status: 'accepted', progress: 'accepted', supplierAmount: 190000, respondedAt: '2026-09-28T03:10:00Z', revision: 2 },
    ] },
    vendors: [{ id: 'vendor-1', name: '<A>클린' }],
  });
  assert.match(accepted, /파트너가 작업을 수락했습니다/u);
  assert.match(accepted, /data-action="reassign-cleaning-partner"/u);
  assert.match(accepted, /&lt;A&gt;클린/u);
  assert.doesNotMatch(accepted, /customerPhone|buildingId/u);
  const unanswered = CleaningUI.renderCleaningPartnerDispatch({ order: { id: 'order-2' }, dispatch: { orderId: 'order-2', acceptedOfferId: null, offers: [
    { id: 'offer-2', vendorId: 'vendor-2', status: 'expired', supplierAmount: 150000, expiresAt: '2026-09-28T04:00:00Z' },
  ] }, vendors: [{ id: 'vendor-2', name: '한결청소', phone: '010-1234-5678' }] });
  assert.match(unanswered, /응답 기한 만료/u);
  assert.match(unanswered, /다음 파트너에게 제안/u);
  assert.match(unanswered, /start-cleaning-partner-offer/u);
  assert.match(unanswered, /data-action="retry-cleaning-partner-offer"/u);
  assert.match(unanswered, /tel:01012345678/u);
  assert.match(unanswered, /전화 확인/u);
});
