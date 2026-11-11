const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Policy = require('../src/office-feature-policy');
const Mutations = require('../src/mutation-policy');
const { FirebaseRemoteClient } = require('../src/remote');
const read = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');

test('retired and hidden office routes cannot be restored by old links', () => {
  for (const view of [...Policy.retiredViews, ...Policy.hiddenViews]) assert.equal(Policy.resolveView(view), 'officeHome');
  for (const view of [...Policy.officeViews, 'dashboard', 'weeklyReports', 'cases']) assert.equal(Policy.resolveView(view), view);
  assert.match(read('app.js'), /currentView = window\.BringOfficeFeaturePolicy\.resolveView\(currentView\)/);
  assert.match(read('office.js'), /BringOfficeFeaturePolicy\.officeViews\.includes\(context\.view\)/);
});

test('navigation, home shortcuts and renderer no longer offer retired features', () => {
  const index = read('index.html'), app = read('app.js'), office = read('office.js');
  for (const view of Policy.retiredViews) {
    assert.doesNotMatch(index, new RegExp(`data-view="${view}"`));
    assert.doesNotMatch(office, new RegExp(`data-office-go="${view}"`));
  }
  assert.match(index, /data-view="officeLeave" hidden/);
  for (const view of Policy.officeViews) assert.ok(index.includes(`data-view="${view}"`), view);
  assert.doesNotMatch(app, /renderGrowth|data-growth-(tab|review|checkin-form)|openOfficeMessengerShortcut/);
  assert.doesNotMatch(office, /function (messengerView|sendMessage|payrollView|approvalsView)|office-summary-card messenger|읽지 않은 메시지/);
  assert.match(office, /function leaveView/);
});

test('retired IPC mutations fail closed, with no renderer or main registrations', () => {
  for (const channel of ['office-message-send','office-messages-read','office-attachment-pick','office-attachment-drop','office-attachment-open','office-messenger-presence','growth-review-save','payroll-save','approval-save','approval-decide']) {
    assert.ok(!read('preload.js').includes(`crm:${channel}`), channel);
    assert.ok(!read('main.js').includes(`"crm:${channel}"`), channel);
    assert.throws(() => Mutations.assertChannelAllowed(`crm:${channel}`, {uid:'test',role:'admin',officeAdmin:true}));
  }
  for (const method of ['sendOfficeMessage','loadOfficeMessageFile','markOfficeMessagesRead','saveApprovalRequest','decideApprovalRequest','savePayrollSlip','saveGrowthReview']) assert.equal(FirebaseRemoteClient.prototype[method], undefined, method);
  assert.doesNotMatch(read('main.js'), /new Notification\(|officeNotificationTracker|open-office-messenger/);
});

test('office refresh does not request retired private feature records', async () => {
  const calls = [];
  const fake = {
    requireOfficeSession: () => ({uid:'test-member',role:'member',officeAdmin:false}),
    captureSessionGuard: () => ({}),
    assertSessionGuardActive: () => {},
    officeRequestSequence: 0,
    dbRequest: async location => { calls.push(location); return {}; },
  };
  const snapshot = await FirebaseRemoteClient.prototype.loadOfficeSnapshot.call(fake);
  assert.deepEqual(snapshot.data.messages, []);
  assert.ok(calls.includes('crmAccess'));
  assert.ok(calls.includes('teamProfiles'));
  assert.ok(calls.includes('officeAttendance/test-member'));
  assert.ok(calls.includes('officeMembers/test-member'));
  assert.ok(!calls.some(location => /office(Mailbox|MessageFiles|Approvals|Payroll)/.test(location)));
});

test('attendance, identities, invitations and weekly-report common contracts stay intact', () => {
  for (const method of ['saveOfficeAttendance','correctOfficeAttendance','saveOfficeDisplayName','loadGrowth','saveGrowthCheckin']) assert.equal(typeof FirebaseRemoteClient.prototype[method], 'function', method);
  assert.match(read('office.js'), /엑셀 다운로드/);
  assert.match(read('office.js'), /currentUser\(\)\.officeAdmin === true/);
  assert.match(read('office.js'), /이메일 인증 링크 보내기/);
  assert.match(read('app.js'), /function renderWeeklyReports/);
  assert.ok(fs.existsSync(path.join(__dirname, '../src/growth-core.js')));
  assert.ok(fs.existsSync(path.join(__dirname, '../src/office-attachment.js')));
});
