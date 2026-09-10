'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createOfficeNotificationTracker } = require('../src/office-notification');

const message = (id, overrides = {}) => Object.assign({
  id,
  senderId: 'member-a',
  receiverId: 'member-me',
  message: '알림에 노출되면 안 되는 본문',
  readAt: '',
  createdAt: '2026-09-01T01:00:00.000Z',
}, overrides);

test('first mailbox snapshot primes without notifying historical messages', () => {
  const notifications = [];
  const tracker = createOfficeNotificationTracker({
    onIncoming: rows => notifications.push(rows),
    now: () => Date.parse('2026-09-01T01:10:00.000Z'),
  });
  tracker.setSession('member-me');
  assert.deepEqual(tracker.ingest({ messages: [message('msg_history_0001')] }), []);
  assert.deepEqual(notifications, []);
  assert.equal(tracker.snapshot().primed, true);
});

test('a just-arrived unread message alerts after login without repeating across account switches', () => {
  const notifications = [];
  const tracker = createOfficeNotificationTracker({
    onIncoming: rows => notifications.push(rows),
    now: () => Date.parse('2026-09-01T01:01:30.000Z'),
  });
  const recent = message('msg_recent_login01', { createdAt: '2026-09-01T01:01:00.000Z' });
  tracker.setSession('member-me');
  assert.deepEqual(tracker.ingest({ messages: [recent] }), [{
    id: 'msg_recent_login01', senderId: 'member-a', createdAt: '2026-09-01T01:01:00.000Z',
  }]);
  assert.equal(notifications.length, 1);
  tracker.setSession('member-other');
  const sameIdForOtherAccount = message('msg_recent_login01', {
    senderId: 'member-b',
    receiverId: 'member-other',
    createdAt: '2026-09-01T01:01:10.000Z',
  });
  assert.deepEqual(tracker.ingest({ messages: [sameIdForOtherAccount] }), [{
    id: 'msg_recent_login01', senderId: 'member-b', createdAt: '2026-09-01T01:01:10.000Z',
  }]);
  assert.equal(notifications.length, 2);
  tracker.setSession('member-me');
  assert.deepEqual(tracker.ingest({ messages: [recent] }), []);
  assert.equal(notifications.length, 2);
});

test('only a new unread inbound message is emitted once', () => {
  const notifications = [];
  const tracker = createOfficeNotificationTracker({ onIncoming: rows => notifications.push(rows) });
  tracker.setSession('member-me');
  tracker.ingest({ messages: [message('msg_history_0001')] });
  const next = message('msg_incoming_0001', { createdAt: '2026-09-01T01:01:00.000Z' });
  assert.deepEqual(tracker.ingest({ messages: [message('msg_history_0001'), next] }), [{
    id: 'msg_incoming_0001', senderId: 'member-a', createdAt: '2026-09-01T01:01:00.000Z',
  }]);
  assert.equal(notifications.length, 1);
  assert.deepEqual(tracker.ingest({ messages: [message('msg_history_0001'), next] }), []);
  assert.equal(notifications.length, 1);
});

test('outgoing, already-read, malformed, and wrong-recipient rows do not notify', () => {
  const notifications = [];
  const tracker = createOfficeNotificationTracker({ onIncoming: rows => notifications.push(rows) });
  tracker.setSession('member-me');
  tracker.ingest({ messages: [] });
  tracker.ingest({ messages: [
    message('msg_outgoing_0001', { senderId: 'member-me', receiverId: 'member-a', createdAt: '2026-09-01T01:01:00.000Z' }),
    message('msg_alreadyread_1', { readAt: '2026-09-01T01:01:02.000Z', createdAt: '2026-09-01T01:01:01.000Z' }),
    message('bad-id', { createdAt: '2026-09-01T01:01:02.000Z' }),
    message('msg_wronguser_01', { receiverId: 'member-b', createdAt: '2026-09-01T01:01:03.000Z' }),
  ] });
  assert.deepEqual(notifications, []);
});

test('session changes establish a fresh baseline and do not leak notifications across accounts', () => {
  const notifications = [];
  const tracker = createOfficeNotificationTracker({ onIncoming: rows => notifications.push(rows) });
  tracker.setSession('member-me');
  tracker.ingest({ messages: [] });
  tracker.ingest({ messages: [message('msg_incoming_0001')] });
  assert.equal(notifications.length, 1);
  tracker.setSession('member-next');
  assert.deepEqual(tracker.ingest({ messages: [message('msg_next_history1', { receiverId: 'member-next' })] }), []);
  assert.equal(notifications.length, 1);
  tracker.reset();
  assert.deepEqual(tracker.ingest({ messages: [message('msg_after_logout1')] }), []);
});

test('same-timestamp ids are de-duplicated while a genuinely new id can notify', () => {
  const notifications = [];
  const tracker = createOfficeNotificationTracker({ onIncoming: rows => notifications.push(rows) });
  tracker.setSession('member-me');
  tracker.ingest({ messages: [message('msg_same_time_001')] });
  tracker.ingest({ messages: [message('msg_same_time_001'), message('msg_same_time_002')] });
  tracker.ingest({ messages: [message('msg_same_time_001'), message('msg_same_time_002')] });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][0].id, 'msg_same_time_002');
});

test('background notifications use legacy-compatible mailbox polling without a new server index', async () => {
  const remote = await fs.readFile(path.join(__dirname, '..', 'src', 'remote.js'), 'utf8');
  assert.match(remote, /startOfficePolling\(generation\)/);
  assert.match(remote, /OFFICE_POLL_INTERVAL_MS/);
  assert.doesNotMatch(remote, /officeInboxLatest/);
});

test('native notification uses fixed private text and click is session-bound', async () => {
  const main = await fs.readFile(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const start = main.indexOf('function showOfficeMessageNotification');
  const end = main.indexOf('function applyRemoteOfficeData', start);
  const source = main.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(source, /title: "BRING CRM 메신저"/);
  assert.match(source, /"새 메시지가 도착했습니다\."/);
  assert.doesNotMatch(source, /\.message\b|fileName|displayName|email/);
  assert.match(source, /currentUid !== expectedUid/);
  assert.match(source, /senderId !== focusedMessengerPeer/);
  assert.match(source, /officeNotificationSessionEpoch !== expectedSessionEpoch/);
  assert.match(source, /flashFrame\(true\)/);
  assert.match(source, /flashFrame\(false\)/);
  assert.match(source, /mainWindow\.restore\(\)/);
  assert.match(source, /mainWindow\.show\(\)/);
  assert.match(source, /mainWindow\.focus\(\)/);
  assert.match(source, /\{ type: "open-office-messenger", peerId \}/);
});

test('native notification suppresses only the selected peer and click is bound to the exact session epoch', async () => {
  const main = await fs.readFile(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const start = main.indexOf('function showOfficeMessageNotification');
  const end = main.indexOf('function applyRemoteOfficeData', start);
  const functionSource = main.slice(start, end);
  const created = [];
  class FakeNotification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; this.shown = 0; created.push(this); }
    show() { this.shown += 1; }
    close() { this.emit('close'); }
  }
  let uid = 'member-me';
  const windowCalls = [];
  const sends = [];
  const context = vm.createContext({
    localTestMode: false,
    officeMessengerPresence: true,
    officeMessengerPeerId: 'member-a',
    officeNotificationSessionEpoch: 4,
    mainWindow: {
      isDestroyed: () => false,
      isFocused: () => true,
      isMinimized: () => true,
      restore: () => windowCalls.push('restore'),
      show: () => windowCalls.push('show'),
      focus: () => windowCalls.push('focus'),
      flashFrame: value => windowCalls.push(['flash', value]),
    },
    Notification: FakeNotification,
    authState: () => ({ user: { uid } }),
    OfficeCore: { normalizeOfficeUserId: value => /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : '' },
    path,
    __dirname: path.join(__dirname, '..', 'src'),
    activeOfficeNotifications: new Set(),
    sendToRenderer: (...args) => sends.push(args),
  });
  vm.runInContext(`${functionSource}\nthis.showOfficeMessageNotification = showOfficeMessageNotification;`, context);
  context.showOfficeMessageNotification([{ senderId: 'member-a' }]);
  assert.equal(created.length, 0);
  context.showOfficeMessageNotification([{ senderId: 'member-a' }, { senderId: 'member-b' }]);
  assert.equal(created.length, 1);
  assert.equal(created[0].shown, 1);
  assert.equal(created[0].options.body, '새 메시지가 도착했습니다.');
  created[0].emit('click');
  assert.deepEqual(windowCalls, [['flash', true], ['flash', false], 'restore', 'show', 'focus']);
  assert.deepEqual(JSON.parse(JSON.stringify(sends)), [['app:shortcut', { type: 'open-office-messenger', peerId: 'member-b' }]]);

  context.officeMessengerPresence = false;
  context.showOfficeMessageNotification([{ senderId: 'member-a' }]);
  context.officeNotificationSessionEpoch += 1;
  created[1].emit('click');
  assert.equal(sends.length, 1);

  context.showOfficeMessageNotification([{ senderId: 'member-a' }]);
  uid = 'member-next';
  created[2].emit('click');
  assert.equal(sends.length, 1);
});

test('taskbar alert remains available when native Windows notifications are unsupported', async () => {
  const main = await fs.readFile(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const start = main.indexOf('function showOfficeMessageNotification');
  const end = main.indexOf('function applyRemoteOfficeData', start);
  const flashes = [];
  const context = vm.createContext({
    localTestMode: false,
    officeMessengerPresence: false,
    officeMessengerPeerId: '',
    officeNotificationSessionEpoch: 1,
    mainWindow: {
      isDestroyed: () => false,
      isFocused: () => false,
      flashFrame: value => flashes.push(value),
    },
    Notification: { isSupported: () => false },
    authState: () => ({ user: { uid: 'member-me' } }),
    OfficeCore: { normalizeOfficeUserId: value => value },
    path,
    __dirname: path.join(__dirname, '..', 'src'),
    activeOfficeNotifications: new Set(),
    sendToRenderer: () => {},
  });
  vm.runInContext(`${main.slice(start, end)}\nthis.showOfficeMessageNotification = showOfficeMessageNotification;`, context);
  context.showOfficeMessageNotification([{ senderId: 'member-a' }]);
  assert.deepEqual(flashes, [true]);
});

test('the structured notification shortcut opens the matching Messenger conversation', async () => {
  const app = await fs.readFile(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  const start = app.indexOf('async function openOfficeMessengerShortcut');
  const end = app.indexOf('api.onShortcut(', start);
  const functionSource = app.slice(start, end);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const context = vm.createContext({
    workspaceCoordinator: { select: async value => calls.push(['workspace', value]) },
    render: () => calls.push(['render']),
    window: { BringOffice: { openConversation: async peerId => calls.push(['conversation', peerId]) } },
  });
  vm.runInContext(`let currentView = "dashboard";\n${functionSource}\nthis.openShortcut = openOfficeMessengerShortcut;\nthis.readView = () => currentView;`, context);
  assert.equal(await context.openShortcut({ type: 'open-office-messenger', peerId: 'member-a' }), true);
  assert.equal(context.readView(), 'officeMessenger');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['workspace', 'operations'],
    ['render'],
    ['conversation', 'member-a'],
  ]);
  calls.length = 0;
  assert.equal(await context.openShortcut({ type: 'open-office-messenger', peerId: '../unsafe' }), false);
  assert.deepEqual(calls, []);
});
