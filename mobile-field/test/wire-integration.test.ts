import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readdir, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FieldApiClient, type UploadStatus } from '../src/api/client';
import { SyncRunner } from '../src/domain/sync';
import { LIMITS, confirmVisit, readyToArchive, type Vault } from '../src/domain/model';
import { toReport } from '../src/domain/report';
import { authorizeMobile, authorizeMobileJob, type MobileAuthDependencies } from '../../functions/src/field-mobile/access';
import { hash, jpeg, makeVault, photo, visit } from './helpers';

// Real loopback HTTP, native Node fetch, production client/queue/SQLite queries.
// The remote service and identity verifiers below are TEST DOUBLES: these tests
// do not verify Firebase credentials, TLS, SQLCipher, Drive, or CRM persistence.
const origin = 'https://field-test.invalid';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });

async function fixture(options: { lose?: 'reserve' | 'chunk' | 'complete'; reject?: 'identity' | 'appCheck' | 'access' | 'job' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'field-wire-'));
  cleanup.push(async () => {
    for (const name of await readdir(dir)) await unlink(join(dir, name));
    await rmdir(dir);
  });
  const path = join(dir, 'test.db');
  let { vault } = await makeVault(path);
  cleanup.push(async () => { await vault.close(); });
  const bytes = new Uint8Array(LIMITS.chunk + jpeg.length); bytes.set(jpeg);
  const p = { ...await photo('staff-a', bytes), reservationRevision: 17, caption: '합성 전송 시험' };
  await vault.saveVisit(visit(), null); await vault.savePhoto(p, bytes, 1);
  const localVisit = (await vault.load()).visits[0]!;
  await vault.saveVisit(confirmVisit(localVisit), localVisit.revision);
  const calls: { method: string; path: string; key?: string; range?: string }[] = [];
  const deps: MobileAuthDependencies = {
    projectId: 'test-company', allowedNativeAppIds: ['native-test'],
    async verifyIdentity(token, revoked) {
      if (token !== 'synthetic-identity' || revoked !== true || options.reject === 'identity') throw Error('TEST_AUTH_DENIED');
      return { uid: 'staff-a', aud: 'test-company', iss: 'https://securetoken.google.com/test-company', email: 'staff@example.invalid', email_verified: true, firebase: { sign_in_provider: 'password' } };
    },
    async verifyAppCheck(token) {
      if (token !== 'synthetic-app-check' || options.reject === 'appCheck') throw Error('TEST_APP_DENIED');
      return { app_id: 'native-test' };
    },
    async readAccess(uid) { return { enabled: uid === 'staff-a' && options.reject !== 'access', email: 'staff@example.invalid', role: 'member' }; },
  };
  let state: UploadStatus = { uploadId: 'upload-a', photoId: p.id, sha256: p.sha256, totalBytes: p.bytes, receivedBytes: 0, state: 'uploading', driveVerified: false, crmLinked: false };
  let reserved = false, completions = 0, lost = false;
  const accepted: Uint8Array[] = [];
  function json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
  }
  function reply(res: ServerResponse, stage?: string) {
    if (!lost && options.lose && stage === options.lose) { lost = true; res.destroy(); return; }
    // Exercise streaming JSON: there is intentionally no Content-Length.
    res.writeHead(200, { 'content-type': 'application/json' });
    const body = JSON.stringify(state); res.write(body.slice(0, 20)); res.end(body.slice(20));
  }
  async function route(req: IncomingMessage, res: ServerResponse) {
    const method = req.method!, url = req.url!;
    calls.push({ method, path: url, key: req.headers['idempotency-key'] as string | undefined, range: req.headers['content-range'] as string | undefined });
    try {
      const actor = await authorizeMobile({ authorization: req.headers.authorization ?? '', appCheck: String(req.headers['x-firebase-appcheck'] ?? '') }, deps);
      authorizeMobileJob(actor, { id: 'job-a', buildingId: 'building-a', active: true, assignedUids: options.reject === 'job' ? ['staff-b'] : ['staff-a'] });
    } catch { json(res, 403, { error: 'TEST_ACCESS_DENIED' }); return; }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    if (method === 'POST' && url === '/v1/field-app/visits/visit-a/photos') {
      const payload = JSON.parse(body.toString());
      if (payload.expectedRevision !== 17 || payload.photoId !== p.id || payload.sha256 !== p.sha256 || req.headers['idempotency-key'] !== 'photo_photo-a') { json(res, 409, {}); return; }
      reserved = true; reply(res, 'reserve'); return;
    }
    if (!reserved) { json(res, 404, {}); return; }
    if (method === 'GET' && url === '/v1/field-app/uploads/upload-a') { reply(res); return; }
    if (method === 'PUT' && url === '/v1/field-app/uploads/upload-a/chunks') {
      const expected = `bytes ${state.receivedBytes}-${state.receivedBytes + body.length - 1}/${p.bytes}`;
      if (req.headers['content-range'] !== expected || req.headers['content-type'] !== 'application/octet-stream') { json(res, 409, {}); return; }
      accepted.push(body); state = { ...state, receivedBytes: state.receivedBytes + body.length }; reply(res, 'chunk'); return;
    }
    if (method === 'POST' && url === '/v1/field-app/uploads/upload-a/complete') {
      if (req.headers['idempotency-key'] !== 'complete_photo-a' || state.receivedBytes !== p.bytes || await hash(Buffer.concat(accepted)) !== p.sha256) { json(res, 409, {}); return; }
      completions++; state = { ...state, state: 'drive_pending' }; reply(res, 'complete'); return;
    }
    json(res, 404, {});
  }
  const server = createServer((req, res) => { void route(req, res).catch(() => json(res, 500, { error: 'TEST_SERVER_FAILURE' })); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address(); if (!address || typeof address === 'string') throw Error('TEST_LISTENER_FAILED');
  const loopback = `http://127.0.0.1:${address.port}`;
  const transport: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== origin || !url.pathname.startsWith('/v1/field-app/')) throw Error('TEST_NETWORK_BOUNDARY');
    return fetch(loopback + url.pathname, init);
  };
  const api = new FieldApiClient(origin + '/v1/field-app', 'staff-a', async () => ({ uid: 'staff-a', idToken: 'synthetic-identity', appCheckToken: 'synthetic-app-check' }), transport);
  return {
    calls, p, bytes, api, vault: () => vault,
    async restart() { await vault.close(); ({ vault } = await makeVault(path)); },
    run: () => new SyncRunner(vault, api).run(),
    received: () => Buffer.concat(accepted), completions: () => completions,
    set: (patch: Partial<UploadStatus>) => { state = { ...state, ...patch }; },
  };
}

async function firstPhoto(vault: Vault) { return (await vault.load()).photos[0]!; }

describe('local wire integration (not live company services)', () => {
  it.each(['reserve', 'chunk', 'complete'] as const)('recovers a lost %s response after reopening SQLite without duplicate bytes/completion', async lose => {
    const f = await fixture({ lose }); await f.run();
    expect((await firstPhoto(f.vault())).errorCode).toBe('NETWORK_UNCERTAIN');
    expect(await f.vault().readBytes(f.p.id)).toEqual(f.bytes);
    await f.restart(); await f.run();
    expect((await firstPhoto(f.vault())).state).toBe('drive_pending');
    expect(f.received()).toEqual(Buffer.from(f.bytes)); expect(f.completions()).toBe(1);
    expect(f.calls.filter(c => c.method === 'PUT')).toHaveLength(2);
    const reservations = f.calls.filter(c => c.path.endsWith('/photos'));
    expect(reservations).toHaveLength(lose === 'reserve' ? 2 : 1);
    expect(new Set(reservations.map(c => c.key))).toEqual(new Set(['photo_photo-a']));
    expect(f.calls.filter(c => c.path.endsWith('/complete'))).toHaveLength(1);
    f.set({ state: 'crm_link_pending', driveVerified: true }); await f.run();
    let saved = await f.vault().load(); expect(readyToArchive(saved.visits[0]!, saved.photos)).toBe(false);
    f.set({ state: 'ready', crmLinked: true }); await f.run();
    saved = await f.vault().load(); expect(readyToArchive(saved.visits[0]!, saved.photos)).toBe(true);
    const report = toReport(saved.visits[0]!, saved.photos);
    expect(report.buildingId).toBe('building-a');
    expect(report.items.find(i => i.key === 'entrance')?.before).toEqual([expect.objectContaining({ id: 'photo-a', caption: '합성 전송 시험' })]);
    expect(f.calls.filter(c => c.method === 'PUT')).toHaveLength(2);
  }, 15_000); // Real sockets plus SQLite reopen may exceed 5s during native builds on Windows.

  it.each(['identity', 'appCheck', 'access', 'job'] as const)('blocks rejected %s across HTTP while retaining the original', async reject => {
    const f = await fixture({ reject }); await f.run();
    expect(await firstPhoto(f.vault())).toMatchObject({ state: 'auth_blocked', errorCode: 'AUTH_REQUIRED', receivedBytes: 0 });
    expect(f.calls).toHaveLength(1); expect(f.received()).toHaveLength(0); expect(f.completions()).toBe(0);
    await f.restart(); await f.run(); expect(f.calls).toHaveLength(1);
    expect(await f.vault().readBytes(f.p.id)).toEqual(f.bytes);
  });

  it('refuses a successful HTTP status that falsely reports completed Drive/CRM storage', async () => {
    const f = await fixture(); await f.run();
    f.set({ state: 'ready', driveVerified: true, crmLinked: false }); await f.run();
    const saved = await f.vault().load();
    expect(saved.photos[0]).toMatchObject({ state: 'failed', errorCode: 'SERVER_RESPONSE_INVALID' });
    expect(readyToArchive(saved.visits[0]!, saved.photos)).toBe(false);
    expect(f.completions()).toBe(1); expect(await f.vault().readBytes(f.p.id)).toEqual(f.bytes);
  });
});
