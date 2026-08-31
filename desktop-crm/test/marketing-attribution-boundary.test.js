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
    requireMutationPermission() { return this.session; },
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
    requireMutationPermission() { return this.session; }, captureSessionGuard() { return { sessionRef: this.session, uid: this.session.uid, generation: this.sessionGeneration }; },
    sessionGuardActive(g) { return this.session === g.sessionRef && this.session.uid === g.uid && this.sessionGeneration === g.generation; },
    dbRequestWithCapturedAuth: async (_path, request) => { if (request.method === 'GET') { fake.session = { uid: 'b', idToken: 'token-b' }; fake.sessionGeneration++; return { id: 'c' }; } writes.push(request); }
  };
  await assert.rejects(() => FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'customer', id: 'c', marketing: {} }), /session changed/i);
  assert.equal(writes.length, 0);
});

test('switch during PATCH uses A token and actor then rejects result', async () => {
  const seen = [];
  const fake = { Core, session: { uid: 'a', idToken: 'token-a', accessRole: 'member', marketingRole: 'marketing' }, sessionGeneration: 1,
    requireMutationPermission() { return this.session; }, captureSessionGuard() { return { sessionRef: this.session, uid: this.session.uid, generation: this.sessionGeneration }; },
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
