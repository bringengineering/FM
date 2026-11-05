import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import W from '../../desktop-crm/src/weekly-report-core.js';

// Exercise Workers' real native fetch instead of only a Node fetch mock. In
// particular, workerd rejects redirect:error before any outbound request.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');
const { buildSync } = wranglerRequire('esbuild');

test('weekly delivery uses native edge fetch, denies redirects, and sends one PDF', { timeout: 60000 }, async () => {
  const source = fileURLToPath(new URL('../src/index.js', import.meta.url)).replaceAll('\\', '/');
  const script = buildSync({ stdin: { resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), contents: `
    import {createWorker,WeeklyReportDeliveries} from ${JSON.stringify(source)};
    export {WeeklyReportDeliveries};
    const worker=createWorker();
    export default {fetch(request,env){return worker.fetch(request,{...env,AI_RATE_LIMITER:{limit:async()=>({success:true})}});}};
  ` }, bundle: true, format: 'esm', platform: 'browser', write: false }).outputFiles[0].text;
  const report = { summary: '테스트', automatic: [], manual: [{ title: '수동 업무', status: 'completed' }], plans: [] };
  const record = { id: 'weekly_report_runtime', uid: 'runtime-user', name: '테스트', week: '2026-10-05', updatedAt: '2026-10-05T00:00:00Z', answers: { done: W.serializeDone(report), next: W.serializePlans([]) } };
  let mode = '', telegramCalls = 0, forbiddenRedirects = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script, compatibilityDate: '2026-08-30',
    durableObjects: { WEEKLY_REPORT_DELIVERIES: { className: 'WeeklyReportDeliveries', useSQLite: true } },
    bindings: { FIREBASE_WEB_API_KEY: 'synthetic-public-key', WEEKLY_REPORT_TELEGRAM_BOT_TOKEN: '123456:' + 'x'.repeat(35), WEEKLY_REPORT_TELEGRAM_CHAT_ID: '-123456789' },
    outboundService: async request => {
      const url = new URL(request.url);
      if (mode === 'redirect' && url.hostname === 'identitytoolkit.googleapis.com') return new Response(null, { status: 302, headers: { location: 'https://redirect-denied.invalid/' } });
      if (url.hostname === 'identitytoolkit.googleapis.com') return Response.json({ users: [{ localId: record.uid, email: 'test@example.test', emailVerified: true }] });
      if (url.hostname === 'bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app') {
        if (mode === 'database-redirect') return new Response(null, { status: 302, headers: { location: 'https://redirect-denied.invalid/' } });
        return Response.json(url.pathname.includes('/access/') ? { role: 'member', enabled: true, email: 'test@example.test' } : record);
      }
      if (url.hostname === 'api.telegram.org') { telegramCalls++; return Response.json({ ok: true, result: { message_id: telegramCalls } }); }
      forbiddenRedirects++;
      return new Response(null, { status: 500 });
    },
  }));
  const request = input => mf.dispatchFetch('https://test/v1/weekly-report-delivery', { method: 'POST', headers: { authorization: 'Bearer synthetic-test', 'content-type': 'application/json' }, body: JSON.stringify({ id: record.id, ...input }) });
  try {
    let response = await request({ action: 'status' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'none');
    mode = 'redirect'; response = await request({ action: 'status' }); assert.equal(response.status, 401);
    mode = 'database-redirect'; response = await request({ action: 'status' }); assert.equal(response.status, 503);
    mode = '';
    const input = { action: 'send', snapshot: report, mimeType: 'application/pdf', pdf: btoa('%PDF-1.7\n' + 'test '.repeat(30) + '\n%%EOF') };
    for (let i = 0; i < 2; i++) { response = await request(input); assert.equal(response.status, 200); assert.equal((await response.json()).status, 'sent'); }
    assert.equal(telegramCalls, 1);
    assert.equal(forbiddenRedirects, 0);
  } finally { await mf.dispose(); }
});
