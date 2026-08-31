const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'database.rules.json'), 'utf8')).rules;

test('marketing rules are company scoped, authenticated, role bounded and soft-delete only', () => {
  const marketing = rules.crmCompany.marketing;
  assert.equal(marketing['.read'], undefined);
  assert.ok(marketing.daily['.read'].includes("marketingRole').val() === 'marketing'"));
  assert.ok(marketing.aggregates['.read'].includes("role').val() === 'viewer'"));
  assert.deepEqual(marketing.aggregates.$aggregateId.$other, { '.validate': false });
  assert.ok(marketing.daily.$recordId['.write'].includes("marketingRole').val() === 'marketing'"));
  assert.ok(marketing.daily.$recordId['.write'].includes("role').val() === 'admin'"));
  assert.ok(marketing.daily.$recordId['.validate'].includes('newData.exists()'));
  assert.ok(marketing.daily.$recordId['.validate'].includes("newData.child('version').val() === data.child('version').val() + 1"));
  assert.ok(marketing.daily.$recordId['.validate'].includes("newData.child('createdAtMs').val() === data.child('createdAtMs').val()"));
  assert.ok(marketing.daily.$recordId['.validate'].includes("newData.child('updatedAtMs').val() === now"));
  assert.ok(marketing.daily.$recordId['.validate'].includes("!data.child('archivedAtMs').exists()"));
  assert.deepEqual(marketing.daily.$recordId.$other, { '.validate': false });
  assert.deepEqual(marketing.audits.$auditId.$other, { '.validate': false });
  assert.deepEqual(marketing.receipts.$receiptId.$other, { '.validate': false });
  assert.deepEqual(marketing.receipts.$receiptId.resultRecord.$other, { '.validate': false });
  assert.ok(marketing.receipts.$receiptId.resultRecord.spend['.validate'].includes("child('spend').val()"));
  assert.ok(marketing.audits.$auditId['.write'].includes('!data.exists()'));
  assert.ok(marketing.audits.$auditId['.validate'].includes("child('beforeSpend')"));
  assert.ok(marketing.receipts.$receiptId['.write'].includes('!data.exists()'));
  assert.equal(marketing.audits.$auditId['.write'].includes('newData.exists()'), true);
  assert.equal(marketing.receipts.$receiptId['.write'].includes('newData.exists()'), true);
});
