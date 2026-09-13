const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../src/google-calendar-client.js');
const client = fs.existsSync(file) ? require(file) : {};
test('calendar client validates action and refuses arbitrary fields', () => {
  assert.equal(typeof client.validateInput, 'function');
  assert.deepEqual(client.validateInput({action:'status'}), {action:'status'});
  assert.throws(() => client.validateInput({action:'events',month:'2026-13'}));
  assert.throws(() => client.validateInput({action:'status',url:'https://evil.invalid'}));
  assert.throws(() => client.validateInput({action:'select',calendarIds:['private']}));
  assert.throws(() => client.validateInput({action:['status']}));
  assert.throws(() => client.validateInput({action:'events',month:['2026-09']}));
});
test('calendar request sends bearer to fixed endpoint and old gateway is unconfigured', async () => {
  assert.equal(typeof client.calendarRequest, 'function');
  let call;
  const value = await client.calendarRequest({endpoint:'https://gateway.example/v1/calendar',idToken:'test-token',input:{action:'status'},fetchImpl:async(url,opts)=>{call={url,opts};return {status:404,ok:false};}});
  assert.equal(call.opts.headers.authorization,'Bearer test-token');
  assert.equal(value.status,'unconfigured');
  await assert.rejects(client.calendarRequest({endpoint:'http://evil.invalid',idToken:'x',input:{action:'status'}}));
});
test('OAuth browser URL is restricted to Google authorization endpoint', () => {
  assert.equal(typeof client.authorizationUrl, 'function');
  assert.throws(()=>client.authorizationUrl('https://evil.invalid/'));
  assert.throws(()=>client.authorizationUrl('https://accounts.google.com/logout'));
  assert.equal(new URL(client.authorizationUrl('https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=test&state=abc')).hostname,'accounts.google.com');
});
test('upstream sensitive errors are never returned to the user',async()=>{
  assert.equal(typeof client.calendarRequest, 'function');
  await assert.rejects(client.calendarRequest({endpoint:'https://gateway.example/v1/calendar',idToken:'x',input:{action:'events',month:'2026-09'},fetchImpl:async()=>({ok:false,status:500,json:async()=>({error:'refresh_token=secret'})})}),error=>!error.message.includes('secret'));
});
