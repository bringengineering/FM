const test = require('node:test');
const assert = require('node:assert/strict');
const Quote = require('../src/quote-core');
const customers = [
  {id: 'first', name: '테스트 건물', phone: '01000000000', roadAddress: '테스트 도로 주소'},
  {id: 'second', name: '테스트 건물', phone: '01000000000', address: '테스트 다른 주소'},
];
test('customer ID disambiguates identical names and phones and survives display edits', () => {
  const quote = Quote.bindCustomer(Quote.createManualDraft(), customers, 'second');
  quote.recipient = '문서용 성명';
  assert.equal(Quote.resolveCustomer(Quote.normalizeDraft(quote), customers).id, 'second');
  assert.equal(quote.siteAddress, '테스트 다른 주소');
});
test('switching customers preserves work, prices, and dates while replacing customer fields', () => {
  const draft = Quote.createDraftFromPrompt('입주청소 12만원', null);
  const first = Quote.bindCustomer(draft, customers, 'first');
  const second = Quote.bindCustomer(first, customers, 'second');
  assert.deepEqual(second.items, draft.items);
  assert.equal(second.totalAmount, draft.totalAmount);
  assert.equal(second.quoteDate, draft.quoteDate);
  assert.equal(first.siteAddress, customers[0].roadAddress);
  assert.equal(Quote.applyMoveInCleaningPreset(second, 150000).customerId, 'second');
});
test('missing, archived, deleted, and ambiguous IDs fail closed', () => {
  for (const rows of [[], [{...customers[0], archivedAt:'date'}], [{...customers[0],deleted:true}], [{...customers[0],deletedAt:'date'}], [customers[0],customers[0]]]) {
    assert.throws(() => Quote.bindCustomer(Quote.createManualDraft(), rows, 'first'));
  }
  assert.throws(() => Quote.resolveCustomer(Quote.createManualDraft(), customers));
});
test('saving requires a current mobile phone and rejects changed or tampered phone', () => {
  const quote = Quote.bindCustomer(Quote.createManualDraft(), customers, 'first');
  for (const phone of ['', '021234567', '01011111111']) {
    assert.throws(() => Quote.resolveCustomer(quote, [{...customers[0], phone}]));
  }
  assert.throws(() => Quote.resolveCustomer({...quote,recipientPhone:'01011111111'},customers));
  const missing = Quote.bindCustomer(quote, [{...customers[0],phone:''}], 'first');
  assert.equal(missing.recipientPhone, '');
});

test('customer selector escapes stored data and explains missing phone', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  const snippet = source.slice(source.indexOf('  function quoteCustomerFields()'), source.indexOf('  function quoteRecipientFields('));
  const escape = value => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const context = {QuoteCore: Quote, store:{customers:[{id:'test',name:'<script>',address:'"unsafe',phone:''}]}, aiAssistantState:{quoteCustomerId:'test'}, cleaningQuoteContext:{}, attr:escape, esc:escape};
  vm.createContext(context);
  vm.runInContext(snippet, context);
  const html = context.quoteCustomerFields();
  assert.match(html, /&lt;script>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /휴대전화 번호를 등록/);
  context.aiAssistantState.quoteLoading = true;
  assert.match(context.quoteCustomerFields(), /data-quote-customer disabled/);
  assert.equal(context.quoteCustomerReady({customerId:'test',recipientPhone:''}), false);
});
