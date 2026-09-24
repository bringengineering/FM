const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');

test('billing ledger uses narrow CRM IPC methods and loads its core before the app', () => {
  const preload = read('preload.js');
  const main = read('main.js');
  const html = read('index.html');
  for (const [method, channel] of [
    ['loadBillingLedger', 'crm:billing-ledger-load'],
    ['saveBillingInvoice', 'crm:billing-invoice-save'],
    ['saveBillingReceipt', 'crm:billing-receipt-save'],
  ]) {
    assert.match(preload, new RegExp(`${method}: input => ipcRenderer.invoke\\("${channel}"`));
    assert.match(main, new RegExp(`secureCanonicalHandle\\("${channel}"`));
  }
  assert.ok(html.indexOf('src="./billing-ledger-core.js"') > 0);
  assert.ok(html.indexOf('src="./billing-ledger-core.js"') < html.indexOf('src="./app.js"'));
});
