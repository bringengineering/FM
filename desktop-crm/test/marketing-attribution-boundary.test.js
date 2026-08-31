'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FirebaseRemoteClient } = require('../src/remote');
const Core = require('../src/core');

test('narrow remote customer attribution update preserves authoritative core fields', async () => {
  const writes = [], current = { id: 'c1', name: 'Keep', phone: '010', notes: 'private', marketing: {} };
  const fake = {
    Core,
    session: { uid: 'u', accessRole: 'member', marketingRole: 'marketing' },
    requireMutationPermission() { return this.session; },
    captureSessionGuard() { return { uid: 'u' }; }, sessionGuardActive() { return true; },
    dbRequest: async (path, request) => request.method === 'GET' ? current : (writes.push({ path, request }), null),
    rootDbRequest: async () => { throw new Error('wrong root'); }
  };
  const result = await FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'customer', id: 'c1', marketing: { firstSource: 'naver_blog', validLead: true, invalidReason: 'spam' } });
  assert.equal(result.ok, true);
  assert.deepEqual(writes[0].request.body.marketing, { firstSource: 'naver_blog', validLead: true });
  assert.equal(writes[0].request.body.marketingUpdatedBy, 'u');
  assert.match(writes[0].request.body.marketingUpdatedAt, /^\d{4}-/);
  assert.equal(current.name, 'Keep'); assert.equal(current.notes, 'private');
});

test('narrow remote attribution denies viewer and unstable ids', async () => {
  const fake = { Core, session: { uid: 'v', accessRole: 'viewer' }, requireMutationPermission() { return this.session; } };
  await assert.rejects(() => FirebaseRemoteClient.prototype.updateMarketingAttribution.call(fake, { kind: 'case', id: '../x', marketing: {} }), /forbidden|invalid/i);
});
