import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { projectMorningDigest, runMorningDigest, seoulDay, sendMorningMessage } from '../src/telegram-morning-core.js';
import { MORNING_CRON, morningReady, morningSourceReady, readMorningSource, TelegramMorningJobs } from '../src/telegram-morning-jobs.js';
import { createWorker } from '../src/index.js';

const require = createRequire(import.meta.url);
const Calendar = require('../../desktop-crm/src/work-calendar.js');
const Core = require('../../desktop-crm/src/core.js');
const DAY = '2026-10-19', NOW = Date.parse('2026-10-18T21:00:00Z');
const building = { id: 'building_1', name: '예시 건물' };
const contract = { id: 'contract_1', name: '정기 청소', buildingId: building.id, customerId: 'customer_1',
  type: '청소', billingCycle: '월 정기', status: '진행 중', owner: '담당자', startDate: '2026-10-01',
  paymentDueDate: DAY, amount: 300000, cleaningSchedule: { mode: 'weekly', weekday: 1, count: 4 } };
const source = (contracts = { [contract.id]: contract }, serviceRecords = null) => ({ contracts, serviceRecords, buildings: { [building.id]: building } });
const env = () => ({ TELEGRAM_MORNING_ENABLED: 'true', TELEGRAM_MORNING_JOBS: {},
  WEEKLY_REPORT_TELEGRAM_BOT_TOKEN: `123456789:${'a'.repeat(35)}`, WEEKLY_REPORT_TELEGRAM_CHAT_ID: '-100123456789',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'reader@bring-fm.iam.gserviceaccount.com', GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'test-key' });

test('UTC cron selects the following Seoul day at 06:00', () => {
  assert.equal(MORNING_CRON, '0 21 * * *');
  assert.equal(seoulDay(new Date(NOW)), DAY);
  assert.equal(seoulDay(new Date('2026-10-18T14:59:59Z')), '2026-10-18');
});

test('empty sections are omitted; an entirely empty day has no message', () => {
  assert.deepEqual(projectMorningDigest({ contracts: null, serviceRecords: null, buildings: null }, DAY).messages, []);
  const workOnly = projectMorningDigest(source({}, { task_1: { title: '현장 점검', scheduledDate: DAY } }), DAY);
  assert.match(workOnly.messages.join(''), /현장 점검/);
  assert.doesNotMatch(workOnly.messages.join(''), /계약 입금/);
  const paymentOnly = projectMorningDigest(source({ payment: { ...contract, cleaningSchedule: { mode: 'manual' } } }), DAY);
  assert.match(paymentOnly.messages.join(''), /오늘 계약 입금/);
  assert.doesNotMatch(paymentOnly.messages.join(''), /오늘 업무일정/);
});

test('derived work agrees with the current CRM calendar including moved occurrences', () => {
  for (const cleaningSchedule of [{ mode: 'weekly', weekday: 1, count: 4 },
    { mode: 'twice_monthly', weekday: 1, weekPattern: 'first_third' },
    { mode: 'twice_monthly', weekday: 1, weekPattern: 'second_fourth' }, { mode: 'once' }, { mode: 'manual' }]) {
    const contracts = [{ ...contract, cleaningSchedule }];
    for (const day of ['2026-10-05', '2026-10-12', DAY, '2026-10-26', '2026-11-02']) {
      const expected = Calendar.buildModel({ contracts, buildings: [building], serviceRecords: [] }, { today: day, selectedDate: day }).selectedEvents;
      assert.deepEqual(projectMorningDigest(source({ contract_1: contracts[0] }), day).schedules.map(row => row.title), expected.map(row => row.title), `${cleaningSchedule.mode} ${day}`);
    }
  }
  const moved = { title: '옮긴 청소', scheduledDate: '2026-10-20', buildingId: building.id,
    sourceContractId: contract.id, sourceContractBuildingId: building.id, sourceContractDate: DAY };
  assert.deepEqual(projectMorningDigest(source(undefined, { moved }), DAY).schedules, []);
  assert.deepEqual(projectMorningDigest(source(undefined, { moved }), '2026-10-20').schedules.map(row => row.title), ['옮긴 청소']);
});

test('payment dates/status agree with CRM for one-off, monthly, annual and month ends', () => {
  for (const billingCycle of ['건별', '월 정기', '연간', '기타']) {
    const item = { ...contract, billingCycle, paymentDueDate: '2026-01-31', collectionStatus: '입금 완료',
      paymentCollections: { '2026-02-28': '입금 완료' }, cleaningSchedule: { mode: 'manual' } };
    for (const day of ['2026-01-31', '2026-02-28', '2026-03-31', '2027-01-31']) {
      const expected = Core.contractPaymentRows([item], day.slice(0, 7), undefined, day).filter(row => row.dueDate === day);
      assert.deepEqual(projectMorningDigest(source({ contract_1: item }), day).payments.map(row => [row.amount, row.status]), expected.map(row => [row.amount, row.collectionStatus]), `${billingCycle} ${day}`);
    }
  }
});

test('cancelled, deleted and archived entries do not revive; invalid data fails closed', () => {
  assert.deepEqual(projectMorningDigest(source({ gone: { ...contract, archivedAt: '2026-10-01' } }, {
    cancelled: { title: '취소', scheduledDate: DAY, status: 'cancelled' },
    deleted: { title: '삭제', scheduledDate: DAY, deleted: true }, tomorrow: { title: '내일', scheduledDate: '2026-10-20' },
  }), DAY).messages, []);
  assert.throws(() => projectMorningDigest({ ...source(), contracts: [] }, DAY), /telegram_source_invalid/);
});

test('untrusted text is escaped and long digests keep every row within Telegram limits', () => {
  const tasks = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`task_${index}`, {
    title: `작업-${index}-<b>& 확인`, scheduledDate: DAY, startTime: '09:00', buildingId: building.id,
  }]));
  const digest = projectMorningDigest(source({}, tasks), DAY);
  assert.ok(digest.messages.length > 1);
  for (const message of digest.messages) {
    assert.ok(message.length <= 3500);
    assert.equal(message.match(/<b>/gu)?.length, message.match(/<\/b>/gu)?.length);
    assert.doesNotMatch(message, /<b>& 확인/);
  }
  for (let index = 0; index < 80; index++) assert.equal(digest.messages.join('\n').split(`작업-${index}-&lt;b&gt;&amp; 확인`).length, 2);
});

function runtime(readSource = async () => source()) {
  let receipt = null; const sent = [];
  const dependencies = { attemptId: 'test-attempt', readSource,
    claim: async (_day, value) => { if (receipt && receipt.status !== 'failed') return false; receipt = { ...value }; return true; },
    update: async (_day, value) => { receipt = { ...receipt, ...value }; }, send: async message => { sent.push(message); } };
  return { dependencies, sent, receipt: () => receipt };
}

test('concurrent invocations are claimed once and receipts contain no message data', async () => {
  const f = runtime();
  const results = await Promise.all([runMorningDigest(DAY, f.dependencies), runMorningDigest(DAY, f.dependencies)]);
  assert.deepEqual(results.map(result => result.status).sort(), ['duplicate', 'sent']);
  assert.equal(f.sent.length, 1); assert.equal(f.receipt().status, 'sent');
  assert.doesNotMatch(JSON.stringify(f.receipt()), /정기 청소/);
});

test('empty days never call Telegram and source failures are not treated as empty', async () => {
  const empty = runtime(async () => source({}));
  assert.deepEqual(await runMorningDigest(DAY, empty.dependencies), { status: 'skipped' }); assert.equal(empty.sent.length, 0);
  const unavailable = runtime(async () => { throw new Error('private-source-data'); });
  await assert.rejects(runMorningDigest(DAY, unavailable.dependencies), /telegram_morning_failed/);
  assert.equal(unavailable.receipt().status, 'failed'); assert.equal(unavailable.sent.length, 0);
});

test('uncertain delivery is never automatically replayed', async () => {
  const f = runtime(); let calls = 0;
  f.dependencies.send = async () => { calls++; throw new Error('secret-transport-url'); };
  await assert.rejects(runMorningDigest(DAY, f.dependencies), /telegram_morning_failed/);
  assert.equal(f.receipt().status, 'unknown');
  assert.deepEqual(await runMorningDigest(DAY, f.dependencies), { status: 'duplicate' }); assert.equal(calls, 1);
});

test('Telegram destination is fixed HTTPS, redirects fail and transport details stay private', async () => {
  const settings = env(); const calls = [];
  await sendMorningMessage(settings.WEEKLY_REPORT_TELEGRAM_BOT_TOKEN, settings.WEEKLY_REPORT_TELEGRAM_CHAT_ID, '업무', async (url, options) => {
    calls.push({ url: new URL(url), options }); return Response.json({ ok: true, result: { message_id: 1 } });
  });
  assert.equal(calls[0].url.hostname, 'api.telegram.org'); assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(JSON.parse(calls[0].options.body).chat_id, settings.WEEKLY_REPORT_TELEGRAM_CHAT_ID);
  await assert.rejects(sendMorningMessage(settings.WEEKLY_REPORT_TELEGRAM_BOT_TOKEN, settings.WEEKLY_REPORT_TELEGRAM_CHAT_ID, '업무', async () => new Response(null, { status: 302 })), /telegram_delivery_unconfirmed/);
});

test('server authenticates only fixed bring-fm source GETs and does not need employee tokens', async () => {
  const calls = [];
  const data = await readMorningSource({ env: env(), now: () => NOW, sign: async () => 'test-signature', fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), options });
    if (String(url).includes('oauth2.googleapis.com')) return Response.json({ access_token: 'test-server-access' });
    return Response.json(null);
  } });
  assert.deepEqual(data, { serviceRecords: null, contracts: null, buildings: null });
  assert.equal(calls.length, 4);
  for (const call of calls.slice(1)) {
    assert.equal(call.url.origin, 'https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app');
    assert.equal(call.url.search, ''); assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'manual'); assert.equal(call.options.headers.authorization, 'Bearer test-server-access');
  }
  assert.equal(morningReady({ ...env(), GOOGLE_SERVICE_ACCOUNT_EMAIL: 'reader@bring-fm-hj.iam.gserviceaccount.com' }), false);
  await assert.rejects(readMorningSource({ env: env(), sign: async () => 'signature', fetchImpl: async () => new Response('private-error', { status: 403 }) }), /TELEGRAM_MORNING_UNAVAILABLE/);
});

test('private durable job serializes duplicate requests and has no public Worker route', async () => {
  const saved = new Map(); let sends = 0;
  const storage = { get: async key => structuredClone(saved.get(key)), put: async (key, value) => { saved.set(key, structuredClone(value)); } };
  const job = new TelegramMorningJobs({ storage }, env(), { now: () => NOW, readSource: async () => source(), fetchImpl: async () => {
    sends++; return Response.json({ ok: true, result: { message_id: 1 } });
  } });
  const request = () => new Request('https://internal/run', { method: 'POST', body: JSON.stringify({ day: DAY }) });
  const results = await Promise.all([job.fetch(request()), job.fetch(request())]);
  assert.deepEqual((await Promise.all(results.map(result => result.json()))).map(result => result.status), ['sent', 'duplicate']);
  assert.equal(sends, 1);
  const worker = createWorker();
  assert.equal((await worker.fetch(new Request('https://ai.example/v1/telegram-morning'), env())).status, 404);
});

test('existing server-reader tokens must belong to bring-fm and permission errors fail closed', async () => {
  const claims = { aud: 'bring-fm', iss: 'https://securetoken.google.com/bring-fm', sub: 'server-reader' };
  const idToken = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  const settings = { TELEGRAM_MORNING_ENABLED: 'true', WALLBOARD_READER_UID: 'server-reader',
    WALLBOARD_READER_REFRESH_TOKEN: 'test-reader-refresh', FIREBASE_WEB_API_KEY: 'test-public-key' };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url), options });
    if (String(url).includes('securetoken.googleapis.com')) return Response.json({ user_id: 'server-reader', id_token: idToken });
    return Response.json(null);
  };
  await readMorningSource({ env: settings, fetchImpl });
  assert.equal(calls.length, 4);
  for (const call of calls.slice(1)) {
    assert.equal(call.url.searchParams.get('auth'), idToken);
    assert.equal(call.options.redirect, 'manual');
  }
  const wrongToken = `header.${Buffer.from(JSON.stringify({ ...claims, aud: 'bring-fm-hj' })).toString('base64url')}.signature`;
  await assert.rejects(readMorningSource({ env: settings, fetchImpl: async () => Response.json({ user_id: 'server-reader', id_token: wrongToken }) }), /TELEGRAM_MORNING_UNAVAILABLE/);
  await assert.rejects(readMorningSource({ env: settings, fetchImpl: async url => String(url).includes('securetoken.googleapis.com')
    ? Response.json({ user_id: 'server-reader', id_token: idToken }) : new Response('denied', { status: 403 }) }), /TELEGRAM_MORNING_UNAVAILABLE/);
});

test('daily cron is independent of TV refresh and forwards the scheduled Seoul day', async () => {
  const calls = []; let tvCalls = 0;
  const settings = { ...env(), WALLBOARD_ENABLED: 'true', WALLBOARD_SCHEDULED_REFRESH_ENABLED: 'true', TELEGRAM_MORNING_JOBS: {
    idFromName: name => name, get: () => ({ fetch: async request => { calls.push(await request.json()); return Response.json({ ok: true }); } }),
  } };
  const worker = createWorker({ scheduledWallboardRefresh: async () => { tvCalls++; } });
  await worker.scheduled({ cron: MORNING_CRON, scheduledTime: NOW }, settings);
  assert.deepEqual(calls, [{ day: DAY }]); assert.equal(tvCalls, 0);
  await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: NOW }, settings);
  assert.equal(tvCalls, 1);
  await worker.scheduled({ cron: MORNING_CRON, scheduledTime: NOW }, { ...settings, TELEGRAM_MORNING_ENABLED: 'false' });
  assert.equal(calls.length, 1);
});

test('live health probes are private, cached, read-only and never expose rows or send Telegram', async () => {
  let reads = 0, sends = 0, timestamp = NOW;
  const stored = new Map();
  const job = new TelegramMorningJobs({ storage: {
    get: async key => stored.get(key), put: async (key, value) => stored.set(key, value),
  } }, env(), { now: () => timestamp,
    readSource: async () => { reads++; return source(); },
    fetchImpl: async () => { sends++; throw new Error('must-not-send'); },
  });
  const settings = { ...env(), TELEGRAM_MORNING_JOBS: {
    idFromName: name => name, get: () => ({ fetch: request => job.fetch(request) }),
  } };
  assert.equal(await morningSourceReady(settings), true);
  assert.equal(await morningSourceReady(settings), true);
  assert.equal(reads, 1); assert.equal(sends, 0); assert.equal(stored.size, 0);
  const response = await createWorker().fetch(new Request('https://ai.example/health'), settings);
  const health = await response.json();
  assert.equal(health.morningTelegram, true);
  assert.doesNotMatch(JSON.stringify(health), /예시|정기|customer_|contract_|building_|reader@|test-key/);
  timestamp += 60001;
  job.readSource = async () => { reads++; throw new Error('private-source-secret'); };
  assert.equal(await morningSourceReady(settings), false);
  assert.equal(await morningSourceReady(settings), false);
  assert.equal(reads, 2); assert.equal(sends, 0);
  assert.equal((await job.fetch(new Request('https://internal/probe'))).status, 404);
  assert.equal((await createWorker().fetch(new Request('https://ai.example/probe'), settings)).status, 404);
});
