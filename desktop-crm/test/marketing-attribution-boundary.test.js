'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FirebaseRemoteClient } = require('../src/remote');
const Core = require('../src/core');

test('narrow remote customer attribution update preserves authoritative core fields', async () => {
  const writes = [], current = { id: 'c1', name: 'Keep', phone: '010', notes: 'private', marketing: {} };
  const fake = {
    Core,
    session: { uid: 'u', idToken: 'token-a', accessRole: 'member', marketingRole: 'marketing' }, sessionGeneration: 1,
    requireMutationPermission() { return this.session; }, ensureIdToken: async () => 'token-a',
    captureSessionGuard() { return { uid: 'u' }; }, sessionGuardActive() { return true; },
    dbRequestWithCapturedAuth: async (path, request, root, snapshot) => request.method === 'GET' ? current : (writes.push({ path, request, root, token: snapshot.idToken }), null)
  };
  const result = await FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'customer', id: 'c1', marketing: { firstSource: 'naver_blog', validLead: true, invalidReason: 'spam' } });
  assert.equal(result.ok, true);
  assert.deepEqual(writes[0].request.body.marketing, { firstSource: 'naver_blog', validLead: true });
  assert.equal(writes[0].request.body.marketingUpdatedBy, 'u');
  assert.match(writes[0].request.body.marketingUpdatedAt, /^\d{4}-/);
  assert.equal(writes[0].token, 'token-a');
  assert.equal(current.name, 'Keep'); assert.equal(current.notes, 'private');
});

test('session switch before PATCH prevents write and never uses the new token', async () => {
  const writes = [];
  const fake = { Core, session: { uid: 'a', idToken: 'token-a', accessRole: 'member', marketingRole: 'marketing' }, sessionGeneration: 1,
    requireMutationPermission() { return this.session; }, ensureIdToken: async () => 'token-a', captureSessionGuard() { return { sessionRef: this.session, uid: this.session.uid, generation: this.sessionGeneration }; },
    sessionGuardActive(g) { return this.session === g.sessionRef && this.session.uid === g.uid && this.sessionGeneration === g.generation; },
    dbRequestWithCapturedAuth: async (_path, request) => { if (request.method === 'GET') { fake.session = { uid: 'b', idToken: 'token-b' }; fake.sessionGeneration++; return { id: 'c' }; } writes.push(request); }
  };
  await assert.rejects(() => FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'customer', id: 'c', marketing: {} }), /session changed/i);
  assert.equal(writes.length, 0);
});

test('switch during PATCH uses A token and actor then rejects result', async () => {
  const seen = [];
  const fake = { Core, session: { uid: 'a', idToken: 'token-a', accessRole: 'member', marketingRole: 'marketing' }, sessionGeneration: 1,
    requireMutationPermission() { return this.session; }, ensureIdToken: async () => 'token-a', captureSessionGuard() { return { sessionRef: this.session, uid: this.session.uid, generation: this.sessionGeneration }; },
    sessionGuardActive(g) { return this.session === g.sessionRef && this.sessionGeneration === g.generation; },
    dbRequestWithCapturedAuth: async (_path, request, _root, snapshot) => { if (request.method === 'GET') return { id: 'c' }; seen.push({ token: snapshot.idToken, actor: request.body.marketingUpdatedBy }); fake.session = { uid: 'b', idToken: 'token-b' }; fake.sessionGeneration++; }
  };
  await assert.rejects(() => FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'customer', id: 'c', marketing: {} }), /session changed/i);
  assert.deepEqual(seen, [{ token: 'token-a', actor: 'a' }]);
});

test('narrow remote attribution denies viewer and unstable ids', async () => {
  const fake = { Core, session: { uid: 'v', accessRole: 'viewer' }, requireMutationPermission() { return this.session; } };
  await assert.rejects(() => FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'case', id: '../x', marketing: {} }), /forbidden|invalid/i);
});

test('remote mutation boundary denies marketing-only whole saves but permits narrow attribution capability', () => {
  const fake = { Core, session: { uid: 'm', accessRole: 'member', role: 'member', marketingRole: 'marketing' } };
  assert.throws(() => FirebaseRemoteClient.prototype.requireMutationPermission.call(fake, { name: 'forged' }), error => error && error.code === 'MARKETING_ONLY_FORBIDDEN');
  assert.equal(FirebaseRemoteClient.prototype.requireMutationPermission.call(fake, {}, 'marketing-attribution'), fake.session);
});

test('expired A refreshes once before requests and both use fresh A token', async () => {
  let refreshes = 0; const tokens = [];
  const fake = { Core, session: { uid: 'a', idToken: 'expired-a', accessRole: 'member', marketingRole: 'marketing' }, sessionGeneration: 1,
    requireMutationPermission() { return this.session; }, ensureIdToken: async () => { refreshes++; fake.session.idToken = 'fresh-a'; return 'fresh-a'; },
    captureSessionGuard() { return { sessionRef: this.session, uid: 'a', generation: 1 }; }, sessionGuardActive(g) { return this.session === g.sessionRef && this.sessionGeneration === g.generation; },
    dbRequestWithCapturedAuth: async (_p, request, _r, snapshot) => { tokens.push(snapshot.idToken); return request.method === 'GET' ? { id: 'c' } : null; }
  };
  await FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'customer', id: 'c', marketing: {} });
  assert.equal(refreshes, 1); assert.deepEqual(tokens, ['fresh-a', 'fresh-a']);
});

test('switch during refresh performs no database request', async () => {
  let requests = 0;
  const fake = { Core, session: { uid: 'a', idToken: 'expired-a', accessRole: 'member', marketingRole: 'marketing' }, sessionGeneration: 1,
    requireMutationPermission() { return this.session; }, ensureIdToken: async () => { fake.session = { uid: 'b', idToken: 'token-b' }; fake.sessionGeneration++; return 'token-b'; },
    captureSessionGuard() { return { sessionRef: this.session, uid: this.session.uid, generation: this.sessionGeneration }; }, sessionGuardActive(g) { return this.session === g.sessionRef && this.sessionGeneration === g.generation; },
    dbRequestWithCapturedAuth: async () => { requests++; }
  };
  await assert.rejects(() => FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'customer', id: 'c', marketing: {} }), /session changed/i);
  assert.equal(requests, 0);
});

test('refresh failure is bounded and performs no database request', async () => {
  let requests = 0;
  const fake = { Core, session: { uid: 'a', idToken: 'expired-secret', accessRole: 'member', marketingRole: 'marketing' }, sessionGeneration: 1,
    requireMutationPermission() { return this.session; }, ensureIdToken: async () => { const error = new Error('auth refresh failed'); error.code = 'AUTH_EXPIRED'; throw error; },
    captureSessionGuard() { return { sessionRef: this.session, uid: 'a', generation: 1 }; }, sessionGuardActive() { return true; }, dbRequestWithCapturedAuth: async () => { requests++; }
  };
  await assert.rejects(() => FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'customer', id: 'c', marketing: {} }), error => error.code === 'AUTH_EXPIRED' && !error.message.includes('expired-secret'));
  assert.equal(requests, 0);
});

test('attribution uses entity ETag CAS and normalizes 412 with current comparison', async () => {
  const calls = []; let reads = 0;
  const fake = { Core, session: { uid: 'a', idToken: 'token-a', accessRole: 'member', marketingRole: 'marketing' }, sessionGeneration: 1,
    requireMutationPermission() { return this.session; }, ensureIdToken: async () => 'token-a',
    captureSessionGuard() { return { sessionRef: this.session, uid: 'a', generation: 1 }; }, sessionGuardActive() { return true; },
    dbRequestWithCapturedAuth: async (_path, request, _root, snapshot) => {
      calls.push({ request, token: snapshot.idToken });
      if (request.method === 'GET') return { value: reads++ ? { id: 'c', marketing: { keyword: 'server' } } : { id: 'c', marketing: { keyword: 'old' } }, etag: reads === 1 ? 'etag-old' : 'etag-current' };
      const error = new Error('precondition failed'); error.status = 412; throw error;
    }
  };
  await assert.rejects(() => FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'customer', id: 'c', marketing: { keyword: 'draft' } }), error => {
    assert.equal(error.code, 'MARKETING_ATTRIBUTION_CONFLICT');
    assert.deepEqual(error.currentMarketing, { keyword: 'server' });
    assert.equal(error.currentEtag, 'etag-current');
    assert.equal(JSON.stringify(error).includes('token-a'), false);
    return true;
  });
  assert.equal(calls[1].request.headers['If-Match'], 'etag-old');
  assert.equal(calls[1].request.body.marketing.keyword, 'draft');
  assert.deepEqual(calls.map(call => call.token), ['token-a', 'token-a', 'token-a']);
});
