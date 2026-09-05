const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
function endpoints(env = {}) {
  const declarations = main.split('\n').filter(line => /^const CRM_(AI_GATEWAY|AI_TRANSCRIBE|CONTRACT_GATEWAY|DOCUMENT_DELIVERY)_URL =/.test(line)).join('\n');
  return vm.runInNewContext(declarations + '\n[CRM_AI_GATEWAY_URL, CRM_AI_TRANSCRIBE_URL, CRM_CONTRACT_GATEWAY_URL, CRM_DOCUMENT_DELIVERY_URL]', {process: {env}, URL});
}
test('all CRM gateway services default to the company-owned host', () => {
  const urls = endpoints();
  assert.equal(urls.length, 4);
  for (const url of urls) assert.equal(new URL(url).origin, 'https://bring-crm-ai-gateway.bringengineering1008.workers.dev');
  assert.deepEqual(Array.from(urls, url => new URL(url).pathname), ['/v1/assist', '/v1/transcribe', '/v1/contracts', '/v1/document-delivery']);
});
test('an explicit operator endpoint override remains supported', () => {
  for (const url of endpoints({BRING_CRM_AI_GATEWAY_URL: 'https://test.example/v1/assist'})) assert.equal(new URL(url).origin, 'https://test.example');
});
