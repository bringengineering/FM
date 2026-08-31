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
    dbRequestWithCapturedAuth: async (path, request, root, snapshot) => request.method === 'GET' ? { value: current.marketing, etag: 'etag-1' } : (writes.push({ path, request, root, token: snapshot.idToken }), null)
  };
  const result = await FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'customer', id: 'c1', marketing: { firstSource: 'naver_blog', validLead: true, invalidReason: 'spam' } });
  assert.equal(result.ok, true);
  assert.equal(writes[0].request.method, 'PUT');
  assert.equal(writes[0].request.body.firstSource, 'naver_blog');
  assert.equal(writes[0].request.body.validLead, true);
  assert.equal(writes[0].request.body.invalidReason, undefined);
  assert.equal(writes[0].request.body._updatedByAuthUid, 'u');
  assert.equal(writes[0].token, 'token-a');
  assert.equal(current.name, 'Keep'); assert.equal(current.notes, 'private');
});

test('session switch before PUT prevents write and never uses the new token', async () => {
  const writes = [];
  const fake = { Core, session: { uid: 'a', idToken: 'token-a', accessRole: 'member', marketingRole: 'marketing' }, sessionGeneration: 1,
    requireMutationPermission() { return this.session; }, ensureIdToken: async () => 'token-a', captureSessionGuard() { return { sessionRef: this.session, uid: this.session.uid, generation: this.sessionGeneration }; },
    sessionGuardActive(g) { return this.session === g.sessionRef && this.session.uid === g.uid && this.sessionGeneration === g.generation; },
    dbRequestWithCapturedAuth: async (_path, request) => { if (request.method === 'GET') { fake.session = { uid: 'b', idToken: 'token-b' }; fake.sessionGeneration++; return { value: null, etag: 'etag-1' }; } writes.push(request); }
  };
  await assert.rejects(() => FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'customer', id: 'c', marketing: {} }), /session changed/i);
  assert.equal(writes.length, 0);
});

test('switch during PUT uses A token and actor then rejects result', async () => {
  const seen = [];
  const fake = { Core, session: { uid: 'a', idToken: 'token-a', accessRole: 'member', marketingRole: 'marketing' }, sessionGeneration: 1,
    requireMutationPermission() { return this.session; }, ensureIdToken: async () => 'token-a', captureSessionGuard() { return { sessionRef: this.session, uid: this.session.uid, generation: this.sessionGeneration }; },
    sessionGuardActive(g) { return this.session === g.sessionRef && this.sessionGeneration === g.generation; },
    dbRequestWithCapturedAuth: async (_path, request, _root, snapshot) => { if (request.method === 'GET') return { value: null, etag: 'etag-1' }; seen.push({ token: snapshot.idToken, actor: request.body._updatedByAuthUid }); fake.session = { uid: 'b', idToken: 'token-b' }; fake.sessionGeneration++; }
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
    dbRequestWithCapturedAuth: async (_p, request, _r, snapshot) => { tokens.push(snapshot.idToken); return request.method === 'GET' ? { value: null, etag: 'etag-1' } : null; }
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

test('attribution uses exact marketing-child ETag PUT CAS and normalizes 412 with current comparison', async () => {
  const calls = []; let reads = 0;
  const fake = { Core, session: { uid: 'a', idToken: 'token-a', accessRole: 'member', marketingRole: 'marketing' }, sessionGeneration: 1,
    requireMutationPermission() { return this.session; }, ensureIdToken: async () => 'token-a',
    captureSessionGuard() { return { sessionRef: this.session, uid: 'a', generation: 1 }; }, sessionGuardActive() { return true; },
    dbRequestWithCapturedAuth: async (_path, request, _root, snapshot) => {
      calls.push({ request, token: snapshot.idToken });
      if (request.method === 'GET') return { value: reads++ ? { keyword: 'server', _version: 2 } : { keyword: 'old', _version: 1 }, etag: reads === 1 ? 'etag-old' : 'etag-current' };
      const error = new Error('precondition failed'); error.status = 412; throw error;
    }
  };
  await assert.rejects(() => FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'customer', id: 'c', marketing: { keyword: 'draft' } }), error => {
    assert.equal(error.code, 'MARKETING_ATTRIBUTION_CONFLICT');
    assert.deepEqual(error.currentMarketing, { keyword: 'server' });
    assert.equal(error.currentVersion, 2);
    assert.equal(error.currentEtag, 'etag-current');
    assert.equal(JSON.stringify(error).includes('token-a'), false);
    return true;
  });
  assert.deepEqual(calls.map(call => call.request.method), ['GET', 'PUT', 'GET']);
  assert.ok(calls.every(call => call.requestPath === undefined));
  assert.equal(calls[1].request.headers['If-Match'], 'etag-old');
  assert.equal(calls[1].request.body.keyword, 'draft');
  assert.equal(calls[1].request.body._version, 2);
  assert.deepEqual(calls[1].request.body._updatedAtMs, { '.sv': 'timestamp' });
  assert.equal(calls[1].request.body._updatedByAuthUid, 'a');
  assert.deepEqual(calls.map(call => call.token), ['token-a', 'token-a', 'token-a']);
});

test('attribution transport targets only the exact marketing child and never parent PATCH', async () => {
  const paths = [];
  const fake = { Core, session: { uid: 'a', operatorId: 'operator_a', idToken: 'token-a', accessRole: 'member', marketingRole: 'marketing' }, sessionGeneration: 1,
    requireMutationPermission() { return this.session; }, ensureIdToken: async () => 'token-a', captureSessionGuard() { return { sessionRef: this.session, uid: 'a', generation: 1 }; }, sessionGuardActive() { return true; },
    dbRequestWithCapturedAuth: async (path, request) => { paths.push([path, request.method]); return request.method === 'GET' ? { value: null, etag: 'null-etag' } : { value: null, etag: 'new-etag' }; }
  };
  await FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'case', id: 'case1', marketing: { keyword: 'draft' } });
  assert.deepEqual(paths, [['cases/case1/marketing', 'GET'], ['cases/case1/marketing', 'PUT']]);
});

test('missing child ETag fails closed before PUT', async () => {
  let writes = 0;
  const fake = { Core, session: { uid: 'a', idToken: 'token-a', accessRole: 'member', marketingRole: 'marketing' }, sessionGeneration: 1,
    requireMutationPermission() { return this.session; }, ensureIdToken: async () => 'token-a', captureSessionGuard() { return { uid: 'a', generation: 1 }; }, sessionGuardActive() { return true; },
    dbRequestWithCapturedAuth: async (_path, request) => { if (request.method === 'GET') return { value: null, etag: '' }; writes++; }
  };
  await assert.rejects(() => FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'customer', id: 'c', marketing: {} }), error => error && error.code === 'MARKETING_ATTRIBUTION_ETAG_MISSING');
  assert.equal(writes, 0);
});

test('fresh verifyAccess composes the active operator used by attribution PUT', async () => {
  const calls = [];
  const fake = { Core, firebase: { databaseUrl: 'https://db.test' }, databaseRoot: 'crmCompany', sessionGeneration: 1,
    session: { uid: 'sales-a', email: 'sales@test', idToken: 'fresh', accessRole: 'member', role: 'member', marketingRole: 'sales' },
    captureSessionContext() { return { sessionRef: this.session, uid: this.session.uid, generation: this.sessionGeneration }; }, sessionContextActive(context) { return this.session === context.sessionRef && this.sessionGeneration === context.generation; },
    requestJson: async url => url.includes('teamProfiles/operator_sales') ? { active: true } : { enabled: true, email: 'sales@test', role: 'member', marketingRole: 'sales', operatorId: 'operator_sales' },
    requireMutationPermission() { return this.session; }, ensureIdToken: async () => 'fresh', captureSessionGuard() { return { sessionRef: this.session, uid: this.session.uid, generation: this.sessionGeneration }; }, sessionGuardActive() { return true; },
    dbRequestWithCapturedAuth: async (path, request) => { calls.push({ path, request }); return request.method === 'GET' ? { value: null, etag: 'etag-1' } : null; }
  };
  await FirebaseRemoteClient.prototype.verifyAccess.call(fake, fake.captureSessionContext(), 'fresh');
  await FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'customer', id: 'c1', marketing: { keyword: 'sales' } });
  assert.equal(fake.session.operatorId, 'operator_sales');
  assert.equal(calls[1].request.body._updatedByOperatorId, 'operator_sales');
  assert.equal(calls[1].request.body._updatedByAuthUid, 'sales-a');
});

test('verifyAccess rejects missing or inactive operator before attribution PUT', async () => {
  for (const access of [{ enabled: true, email: 'm@test', role: 'member', marketingRole: 'marketing' }, { enabled: true, email: 'm@test', role: 'member', marketingRole: 'marketing', operatorId: 'operator_inactive' }]) {
    let writes = 0;
    const fake = { firebase: { databaseUrl: 'https://db.test' }, databaseRoot: 'crmCompany', sessionGeneration: 1, session: { uid: 'm', email: 'm@test' },
      captureSessionContext() { return { sessionRef: this.session, uid: 'm', generation: 1 }; }, sessionContextActive() { return true; },
      requestJson: async url => url.includes('teamProfiles') ? { active: false } : access, dbRequestWithCapturedAuth: async () => { writes++; }
    };
    await assert.rejects(() => FirebaseRemoteClient.prototype.verifyAccess.call(fake, fake.captureSessionContext(), 'fresh'), error => error && error.code === 'ACCESS_DENIED');
    assert.equal(writes, 0);
  }
});
