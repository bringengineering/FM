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

test('existing contracts open a separate evidence-backed billing panel', () => {
  const app = read('app.js');
  assert.match(app, /data-billing-open/u);
  assert.match(app, /async function openBillingLedger\(/u);
  assert.match(app, /api\.loadBillingLedger\(/u);
  assert.match(app, /기존 입금 완료 표시만으로는 실제 입금액에 반영하지 않습니다/u);
  assert.match(app, /api\.saveBillingInvoice\(/u);
  assert.match(app, /api\.saveBillingReceipt\(/u);
  assert.match(app, /관리자만 확정/u);
});

test('billing drafts can be corrected with optimistic revision and viewers only see records', () => {
  const app = read('app.js');
  assert.match(app, /data-billing-edit-invoice/u);
  assert.match(app, /data-billing-edit-receipt/u);
  assert.match(app, /saveBillingRecord\("invoice", \{ \.\.\.existing, amount \}, existing\.revision\)/u);
  assert.match(app, /saveBillingRecord\("receipt", record, existing\?\.revision \|\| 0\)/u);
  assert.match(app, /canWriteCRM\(\) \? `<form id="billingInvoiceForm"/u);
  assert.match(app, /summarizeMonth\(/u);
});

test('admins can void confirmed billing with a reason while draft receipts may target draft invoices', () => {
  const app = read('app.js');
  assert.match(app, /data-billing-void-invoice/u);
  assert.match(app, /data-billing-void-receipt/u);
  assert.match(app, /voidReason/u);
  assert.match(app, /receiptInvoiceChoices = invoices\.filter\(item => item\.status === "approved" \|\| item\.status === "draft"\)/u);
});

test('monthly management report compares legacy finance with confirmed ledger and fails closed', () => {
  const app = read('app.js');
  assert.match(app, /loadManagementBillingLedger/u);
  assert.match(app, /청구 장부를 불러올 수 없습니다/u);
  assert.match(app, /기존 계약 표시 기준/u);
  assert.match(app, /확정 장부 기준/u);
});

test('successful billing mutations invalidate the monthly report ledger cache', () => {
  const app = read('app.js');
  const save = app.slice(app.indexOf('async function saveBillingRecord('), app.indexOf('function industryChecklistFields('));
  assert.match(save, /managementBillingState = \{ month: ""/u);
  assert.match(save, /currentView === "operationsIntelligence"/u);
  assert.match(save, /loadManagementBillingLedger\(managementReportState\.month\)/u);
});

test('monthly report labels an unconfirmed ledger as pending, not zero revenue', () => {
  const app = read('app.js');
  const comparison = app.slice(app.indexOf('function managementBillingComparison('), app.indexOf('async function requestSalesAutomationDraft('));
  assert.match(comparison, /집계 대기/u);
  assert.match(comparison, /approved.*invoices|invoices.*approved/u);
});
