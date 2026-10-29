const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = name => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');

test('preload exposes only narrow marketing record methods', () => {
  const preload = src('preload.js');
  assert.match(preload, /readMarketingRecords:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("crm:marketing-read"\)/);
  assert.match(preload, /commitMarketingRecord:\s*input\s*=>\s*ipcRenderer\.invoke\("crm:marketing-commit", input\)/);
  assert.match(preload, /archiveMarketingRecord:\s*input\s*=>\s*ipcRenderer\.invoke\("crm:marketing-archive", input\)/);
  assert.doesNotMatch(preload, /marketing(?:Path|Request|Token)/);
});

test('main routes marketing through the exact trusted canonical frame and closed validator', () => {
  const main = src('main.js');
  for (const channel of ['crm:marketing-read', 'crm:marketing-commit', 'crm:marketing-archive']) assert.match(main, new RegExp(`secureCanonicalHandle\\("${channel}"`));
  assert.match(main, /MarketingPersistence\.validateCommitInput/);
  assert.match(main, /remoteClient\.readMarketingRecords\(\)/);
  assert.match(main, /MarketingPersistence\.assertMarketingReader\(authState\(\)\.user\)/);
  assert.ok(main.indexOf('MarketingPersistence.assertMarketingReader(authState().user)') < main.indexOf('localMarketingPersistence.read()'));
  assert.match(main, /remoteClient\.commitMarketingRecord/);
  assert.doesNotMatch(main.slice(main.indexOf('crm:marketing-read'), main.indexOf('crm:operations-load')), /writeStore|saveStore|crmShared/);
});
