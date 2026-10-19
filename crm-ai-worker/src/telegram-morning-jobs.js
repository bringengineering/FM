import { boundedJson } from './weekly-report-delivery.js';
import { projectMorningDigest, runMorningDigest, seoulDay, sendMorningMessage, telegramCredentials } from './telegram-morning-core.js';

export const MORNING_CRON = '0 21 * * *'; // Cloudflare uses UTC; 21:00 UTC = 06:00 Seoul next day.
const DATABASE = 'https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app';
const SOURCES = ['serviceRecords', 'contracts', 'buildings'];
const unavailable = () => new Error('TELEGRAM_MORNING_UNAVAILABLE');
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

function sourceCredentials(env) {
  const dedicated = Boolean(env.TELEGRAM_CRM_SERVICE_ACCOUNT_EMAIL || env.TELEGRAM_CRM_SERVICE_ACCOUNT_PRIVATE_KEY);
  if (!dedicated && env.WALLBOARD_READER_REFRESH_TOKEN && env.FIREBASE_WEB_API_KEY && /^[A-Za-z0-9._-]{1,128}$/u.test(env.WALLBOARD_READER_UID || '')) {
    return { reader: true };
  }
  const email = (dedicated ? env.TELEGRAM_CRM_SERVICE_ACCOUNT_EMAIL : env.GOOGLE_SERVICE_ACCOUNT_EMAIL) || '';
  const privateKey = (dedicated ? env.TELEGRAM_CRM_SERVICE_ACCOUNT_PRIVATE_KEY : env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) || '';
  // Never accidentally use the retired bring-fm-hj identity/database.
  if (!/^[a-z0-9-]+@bring-fm\.iam\.gserviceaccount\.com$/u.test(email) || !privateKey) throw unavailable();
  return { email, privateKey };
}

export function morningReady(env) {
  try {
    telegramCredentials(env.WEEKLY_REPORT_TELEGRAM_BOT_TOKEN, env.WEEKLY_REPORT_TELEGRAM_CHAT_ID);
    sourceCredentials(env);
    return Boolean(env.TELEGRAM_MORNING_JOBS && env.TELEGRAM_MORNING_ENABLED === 'true');
  } catch { return false; }
}

// The public health endpoint receives only a boolean. The private object caches
// this bounded, read-only probe; it never sends Telegram or returns source data.
export async function morningSourceReady(env) {
  if (!morningReady(env)) return false;
  try {
    const stub = env.TELEGRAM_MORNING_JOBS.get(env.TELEGRAM_MORNING_JOBS.idFromName('bring-company-telegram-morning'));
    const response = await stub.fetch(new Request('https://telegram-morning-internal/probe', { method: 'POST' }));
    return response.ok && (await boundedJson(response, 1024)).ok === true;
  } catch { return false; }
}

const base64url = value => {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(value);
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/gu, '').replace(/\+/gu, '-').replace(/\//gu, '_');
};

async function signJwt(unsigned, privateKey) {
  const pem = privateKey.replace(/\\n/gu, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/gu, '');
  const raw = Uint8Array.from(atob(pem), char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', raw, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))));
}

// Reuse the dedicated server reader or server-only service-account OAuth.
// The existing identity must already have authorized database read access.
// No Firebase rules, IAM grants or credentials are created by this code.
export async function readMorningSource({ env, fetchImpl = fetch, now = Date.now, sign = signJwt }) {
  try {
    const credentials = sourceCredentials(env);
    let accessToken = '', firebaseReader = false;
    if (credentials.reader) {
      const url = new URL('https://securetoken.googleapis.com/v1/token');
      url.searchParams.set('key', env.FIREBASE_WEB_API_KEY);
      const response = await fetchImpl(url, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.WALLBOARD_READER_REFRESH_TOKEN }),
      });
      if (!response.ok) throw unavailable();
      const auth = await boundedJson(response, 16384);
      if (auth.user_id !== env.WALLBOARD_READER_UID || typeof auth.id_token !== 'string' || auth.id_token.length > 8192) throw unavailable();
      const claims = JSON.parse(atob(auth.id_token.split('.')[1].replace(/-/gu, '+').replace(/_/gu, '/')));
      if (claims.aud !== 'bring-fm' || claims.iss !== 'https://securetoken.google.com/bring-fm' || claims.sub !== env.WALLBOARD_READER_UID) throw unavailable();
      accessToken = auth.id_token; firebaseReader = true;
    } else {
    const { email, privateKey } = credentials;
    const issued = Math.floor(now() / 1000);
    const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({
      iss: email, scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
      aud: 'https://oauth2.googleapis.com/token', iat: issued, exp: issued + 300,
    }))}`;
    const assertion = `${unsigned}.${await sign(unsigned, privateKey)}`;
    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!response.ok) throw unavailable();
    const auth = await boundedJson(response, 8192);
    if (typeof auth.access_token !== 'string' || !auth.access_token || auth.access_token.length > 8192) throw unavailable();
    accessToken = auth.access_token;
    }
    const values = await Promise.all(SOURCES.map(async name => {
      const url = new URL(`${DATABASE}/crmCompany/data/${name}.json`);
      if (firebaseReader) url.searchParams.set('auth', accessToken);
      const result = await fetchImpl(url, {
        method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10000),
        headers: firebaseReader ? { accept: 'application/json' } : { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      });
      if (!result.ok) throw unavailable();
      return boundedJson(result, 2 * 1024 * 1024);
    }));
    return Object.fromEntries(SOURCES.map((name, index) => [name, values[index]]));
  } catch { throw unavailable(); }
}

// No public HTTP route. One private object serializes the company morning job.
// Only minimal receipts/hashes are stored, never message bodies or API tokens.
export class TelegramMorningJobs {
  constructor(state, env, options = {}) {
    this.storage = state.storage; this.env = env; this.queue = Promise.resolve();
    this.probeUntil = 0; this.probeOk = false;
    this.fetchImpl = options.fetchImpl || fetch.bind(globalThis);
    this.now = options.now || Date.now;
    this.readSource = options.readSource || (() => readMorningSource({ env: this.env, fetchImpl: this.fetchImpl, now: this.now }));
  }
  fetch(request) {
    const result = this.queue.then(() => this.run(request));
    this.queue = result.catch(() => {}); return result;
  }
  async run(request) {
    const pathname = new URL(request.url).pathname;
    if (request.method !== 'POST' || !['/run', '/probe'].includes(pathname)) return json({ ok: false, code: 'NOT_FOUND' }, 404);
    try {
      if (!morningReady(this.env)) throw unavailable();
      if (pathname === '/probe') {
        if (this.now() >= this.probeUntil) {
          this.probeOk = false;
          this.probeUntil = this.now() + 60000;
          try {
            projectMorningDigest(await this.readSource(), seoulDay(new Date(this.now())));
            this.probeOk = true;
          } catch { /* Never expose source/authentication errors in health. */ }
        }
        return json({ ok: this.probeOk }, this.probeOk ? 200 : 503);
      }
      const input = await boundedJson(request, 1024);
      if (!input || Object.keys(input).some(key => key !== 'day') || input.day !== seoulDay(new Date(this.now()))) return json({ ok: false, code: 'INVALID_INPUT' }, 400);
      const day = input.day, key = `day:${day}`;
      const { token, chatId } = telegramCredentials(this.env.WEEKLY_REPORT_TELEGRAM_BOT_TOKEN, this.env.WEEKLY_REPORT_TELEGRAM_CHAT_ID);
      const result = await runMorningDigest(day, {
        attemptId: crypto.randomUUID(), readSource: this.readSource,
        claim: async (_day, receipt) => {
          const current = await this.storage.get(key);
          if (current && current.status !== 'failed') return false;
          await this.storage.put(key, { ...receipt, startedAt: new Date(this.now()).toISOString() }); return true;
        },
        update: async (_day, receipt) => {
          await this.storage.put(key, { ...await this.storage.get(key), ...receipt, updatedAt: new Date(this.now()).toISOString() });
        },
        send: message => sendMorningMessage(token, chatId, message, this.fetchImpl),
      });
      return json({ ok: true, status: result.status });
    } catch { return json({ ok: false, code: 'TELEGRAM_MORNING_UNAVAILABLE' }, 503); }
  }
}
