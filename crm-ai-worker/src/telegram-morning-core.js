import Core from '../../desktop-crm/src/core.js';
import Calendar from '../../desktop-crm/src/work-calendar.js';
import { boundedJson } from './weekly-report-delivery.js';

const MAX_MESSAGE = 3500;
const text = (value, limit = 120) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, ' ').trim().slice(0, limit) : '';
const html = value => text(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
const live = row => !row.archivedAt && !row.deletedAt && !row.archived && !row.deleted && !row.isArchived
  && !['archived', 'deleted', 'cancelled', 'canceled', '취소', '무효'].includes(text(row.status));
const validId = value => /^[A-Za-z0-9_-]{1,150}$/u.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);

function rows(value) {
  if (value === null) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('telegram_source_invalid');
  const entries = Object.entries(value);
  if (entries.length > 10000 || new TextEncoder().encode(JSON.stringify(value)).byteLength > 2 * 1024 * 1024) throw new Error('telegram_source_too_large');
  return entries.map(([id, row]) => {
    if (!validId(id) || !row || typeof row !== 'object' || Array.isArray(row)) throw new Error('telegram_source_invalid');
    return { ...row, id };
  });
}

export function seoulDay(at) {
  if (!Number.isFinite(at.getTime())) throw new Error('telegram_date_invalid');
  return new Date(at.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

// Use the same work/contract projection as the actual CRM, including moved
// occurrences, bounded weekly visits and date-specific payment receipts.
export function projectMorningDigest(source, day) {
  if (!Core.isContractPaymentDate(day)) throw new Error('telegram_date_invalid');
  const contracts = rows(source.contracts).filter(live);
  const records = rows(source.serviceRecords), buildings = rows(source.buildings);
  const byBuilding = new Map(buildings.map(row => [row.id, row]));
  const byRecord = new Map(records.map(row => [row.id, row]));
  const model = Calendar.buildModel({ contracts, serviceRecords: records, buildings }, {
    today: day, month: day.slice(0, 7), selectedDate: day,
  });
  const schedules = model.selectedEvents.filter(row => !byRecord.has(row.id) || live(byRecord.get(row.id))).map(row => ({
    id: row.id, title: text(row.title) || '업무일정',
    time: text(row.startTime || row.scheduledTime, 30),
    building: text(byBuilding.get(row.buildingId)?.name) || '현장 미지정',
    owner: text(row.owner, 50) || '담당 미지정', status: row.statusLabel,
  }));
  const payments = Core.contractPaymentRows(contracts, day.slice(0, 7), undefined, day)
    .filter(row => row.dueDate === day).map(row => ({
      id: row.contract.id, title: text(row.contract.name) || '계약',
      building: text(byBuilding.get(row.contract.buildingId)?.name), dueDate: row.dueDate,
      amount: row.amount, status: row.collectionStatus,
    }));
  const header = '<b>📅 ' + day + ' 업무·입금 안내</b>';
  const sections = [
    { title: '<b>🛠 오늘 업무일정 ' + schedules.length + '건</b>', lines: schedules.map(row =>
      (html(row.time) || '시간 미정') + ' · <b>' + html(row.title) + '</b>\n' + html(row.building) + ' · ' + html(row.owner) + ' · ' + row.status) },
    { title: '<b>💰 오늘 계약 입금 ' + payments.length + '건</b>', lines: payments.map(row =>
      '<b>' + html(row.title) + '</b>' + (row.building ? ' · ' + html(row.building) : '') + '\n' + day + ' · ' + row.amount.toLocaleString('ko-KR') + '원 · ' + row.status) },
  ].filter(section => section.lines.length);
  const messages = [];
  let message = header;
  for (const section of sections) {
    let started = false;
    for (const line of section.lines) {
      let addition = (started ? '\n\n' : '\n\n' + section.title + '\n') + line;
      if (message.length + addition.length > MAX_MESSAGE) {
        messages.push(message); message = header; started = false;
        addition = '\n\n' + section.title + '\n' + line;
      }
      message += addition; started = true;
    }
  }
  if (sections.length) messages.push(message);
  return { schedules, payments, messages };
}

// Persist the claim before Telegram. A timeout/crash remains uncertain and
// cannot be automatically replayed by another cron invocation or another PC.
export async function runMorningDigest(day, dependencies) {
  if (!Core.isContractPaymentDate(day)) throw new Error('telegram_date_invalid');
  if (!await dependencies.claim(day, { status: 'preparing', attemptId: dependencies.attemptId })) return { status: 'duplicate' };
  let sending = false;
  try {
    const digest = projectMorningDigest(await dependencies.readSource(), day);
    if (!digest.messages.length) {
      await dependencies.update(day, { status: 'skipped', scheduleCount: 0, paymentCount: 0 });
      return { status: 'skipped' };
    }
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(digest.messages)));
    const fingerprint = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    for (const [index, message] of digest.messages.entries()) {
      await dependencies.update(day, { status: 'sending', fingerprint, part: index + 1, parts: digest.messages.length });
      sending = true;
      await dependencies.send(message);
      await dependencies.update(day, { sentParts: index + 1 });
    }
    await dependencies.update(day, { status: 'sent', scheduleCount: digest.schedules.length, paymentCount: digest.payments.length });
    return { status: 'sent' };
  } catch {
    await dependencies.update(day, { status: sending ? 'unknown' : 'failed' });
    throw new Error('telegram_morning_failed');
  }
}

export function telegramCredentials(token, chatId) {
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,50}$/u.test(token) || !/^-[0-9]{5,20}$/u.test(chatId)) throw new Error('telegram_configuration_missing');
  return { token, chatId };
}

export async function sendMorningMessage(token, chatId, message, fetchImpl = fetch) {
  telegramCredentials(token, chatId);
  if (typeof message !== 'string' || !message || message.length > MAX_MESSAGE) throw new Error('telegram_message_invalid');
  try {
    const response = await fetchImpl('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(25000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
    });
    if (!response.ok) throw new Error();
    const result = await boundedJson(response, 65536);
    if (result.ok !== true || !Number.isSafeInteger(result.result?.message_id)) throw new Error();
  } catch { throw new Error('telegram_delivery_unconfirmed'); }
}


