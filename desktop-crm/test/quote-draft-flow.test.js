const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const QuoteCore = require('../src/quote-core');
const source = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
function harness() {
  const quote = QuoteCore.createManualDraft();
  const c = {aiAssistantState:{quote, quoteContent:'작업 요청',quoteCustomerId:'customer',quoteMode:'manual'}, cleaningQuoteContext:{orderId:'order',confirmedPriceIndices:[0]}, customerDocumentSaving:false,cleaningOrderState:{busy:false},window:{confirm:()=>true},refreshQuotesView(){}};
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('  function quoteDraftActions()'),source.indexOf('  function quoteCustomerFields()')),c);
  return c;
}
test('same or different authoring mode preserves draft and customer', () => {
  const c = harness(), original = c.aiAssistantState.quote;
  const start = source.indexOf('    if (quoteMode) {');
  const block = source.slice(start,source.indexOf('    const manualQuoteCreate',start));
  for (const mode of ['manual','ai','manual']) {
    c.quoteMode = {dataset:{quoteMode:mode}};
    vm.runInContext('(function(){'+block+'})()',c);
    assert.equal(c.aiAssistantState.quote, original);
    assert.equal(c.aiAssistantState.quoteCustomerId,'customer');
    assert.equal(c.aiAssistantState.quoteMode,mode);
  }
});
test('detach preserves draft and releases order lock; new draft clears customer and content', () => {
  const c = harness(), original = c.aiAssistantState.quote;
  assert.match(c.quoteDraftActions(),/data-quote-detach/);
  c.resetQuoteDraft(false);
  assert.equal(c.aiAssistantState.quote,original);
  assert.equal(c.cleaningQuoteContext.orderId,'');
  assert.doesNotMatch(c.quoteDraftActions(),/data-quote-detach/);
  c.resetQuoteDraft(true);
  assert.equal(c.aiAssistantState.quote,null);
  assert.equal(c.aiAssistantState.quoteCustomerId,'');
  assert.equal(c.aiAssistantState.quoteContent,'');
});
test('cancel and ongoing operations cannot erase or detach a draft', () => {
  for (const state of ['cancel','ai','save','order']) {
    const c = harness(), original = c.aiAssistantState.quote;
    if(state==='cancel')c.window.confirm=()=>false;
    if(state==='ai')c.aiAssistantState.quoteLoading=true;
    if(state==='save')c.customerDocumentSaving=true;
    if(state==='order')c.cleaningOrderState.busy=true;
    c.resetQuoteDraft(true);
    assert.equal(c.aiAssistantState.quote,original);
    assert.equal(c.cleaningQuoteContext.orderId,'order');
  }
});
test('local export accepts absent phone but CRM recipient validation stays strict', async () => {
  const quote = {...QuoteCore.createManualDraft(),recipient:'테스트 고객',recipientPhone:'',company:{businessName:'테스트',representative:'테스트',registrationNumber:'000-00-00000'}};
  assert.equal(QuoteCore.recipientComplete(quote,{requireName:true}),true);
  assert.equal(QuoteCore.recipientComplete(quote),false);
  assert.equal(QuoteCore.recipientComplete({recipient:'',recipientPhone:''},{requireName:true}),false);
  const main = fs.readFileSync(require.resolve('../src/main.js'),'utf8');
  let written = 0;
  const c = {QuoteCore,authState:()=>({user:{}}),localTestMode:false,readLocalQuoteSeal:async()=>Buffer.from('seal'),dialog:{showSaveDialog:async()=>({filePath:'fixture'})},mainWindow:null,quotePdfFileName:()=>'',quoteFileName:()=>'',createQuotePdfBytes:async()=>Buffer.from('pdf'),createQuoteWorkbook:()=>Buffer.from('xlsx'),fs:{writeFile:async()=>{written++;}},Buffer};
  vm.createContext(c);
  vm.runInContext(main.slice(main.indexOf('async function exportAiQuote(input)'),main.indexOf('function savedDocumentSession(')),c);
  for(const format of ['pdf','xlsx']) assert.equal((await c.exportAiQuote({quote,copyType:'recipient',format})).ok,true);
  assert.equal(written,2);
});

test('history shows legacy PDF separately and escapes stored titles', () => {
  const c=harness();
  c.aiAssistantState.quoteCustomerId='customer';
  c.store={customers:[{id:'customer'}],buildingDocuments:[]};
  c.SavedCustomerDocuments={historyList:()=>[
    {id:'one',title:'<script>bad</script>',updatedAt:'2026-10-27T12:00:00Z',editable:false,isRevision:false},
    {id:'two',title:'수정 견적',updatedAt:'2026-10-27T12:00:00Z',editable:true,isRevision:true}
  ]};
  c.esc=c.attr=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const html=c.quoteHistoryMarkup();
  assert.match(html,/PDF만 보관/);
  assert.match(html,/&lt;script>/);
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/data-quote-history-preview="one"/);
  assert.doesNotMatch(html,/data-quote-history-load="one"/);
  assert.match(html,/data-quote-history-load="two"/);
  c.cleaningQuoteContext.orderId='order';
  assert.match(c.quoteHistoryMarkup(),/data-quote-history-load="two" disabled/);
});
