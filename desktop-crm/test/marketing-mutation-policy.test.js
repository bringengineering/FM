'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const policyPath = path.join(__dirname, '..', 'src', 'mutation-policy.js');
const Policy = fs.existsSync(policyPath) ? require(policyPath) : {};

test('every renderer IPC channel has an explicit closed classification', () => {
  const channels = [...main.matchAll(/secure(?:Canonical)?Handle\("([^"]+)"/g)].map(match => match[1]);
  assert.ok(channels.length > 40);
  assert.equal(typeof Policy.classification, 'function');
  assert.deepEqual(channels.filter(channel => !Policy.classification(channel)), []);
  assert.throws(() => Policy.assertRegistered('crm:unclassified-new-handler'), /unclassified/i);
});

test('marketing-only member can mutate only daily marketing and narrow attribution', () => {
  const user = { accessRole: 'member', role: 'member', marketingRole: 'marketing' };
  const allowed = ['crm:marketing-commit', 'crm:marketing-archive', 'crm:marketing-attribution-update'];
  for (const channel of allowed) assert.doesNotThrow(() => Policy.assertChannelAllowed(channel, user));
  for (const channel of Object.keys(Policy.CHANNEL_POLICY).filter(channel => Policy.classification(channel) === 'mutation' && !allowed.includes(channel))) {
    assert.throws(() => Policy.assertChannelAllowed(channel, user), error => error && error.code === 'MARKETING_ONLY_FORBIDDEN');
  }
  assert.doesNotThrow(() => Policy.assertChannelAllowed('crm:load', user));
  assert.doesNotThrow(() => Policy.assertChannelAllowed('crm:auth-logout', user));
});
