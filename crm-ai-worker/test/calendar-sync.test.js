import test from 'node:test';
import assert from 'node:assert/strict';
const mod = await import('../src/calendar/sync.js').catch(() => ({}));
const now = Date.parse('2026-09-13T00:00:00Z');
const event = { id: 'a', summary: 'Visit', start: { date: '2026-09-13' }, end: { date: '2026-09-14' }, attendees: [{email:'private'}] };
const reply = (value, status=200) => new Response(JSON.stringify(value), {status});
test('full paging normalizes minimal events and token only after completion', async () => {
  assert.equal(typeof mod.syncCalendar, 'function');
  const urls=[];
  const result=await mod.syncCalendar({calendarId:'company@example.com',now,accessToken:'token',fetchImpl:async url=>{urls.push(String(url));return urls.length===1?reply({items:[event],nextPageToken:'p2'}):reply({items:[],nextSyncToken:'s1'});}});
  assert.equal(result.syncToken,'s1'); assert.equal(result.events.length,1); assert.equal(result.events[0].allDay,true); assert.equal(result.events[0].attendees,undefined);
  assert.match(urls[0],/timeMin=/); assert.match(urls[1],/pageToken=p2/);
  const fields=new URL(urls[0]).searchParams.get('fields');assert.ok(fields?.includes('nextSyncToken'));assert.doesNotMatch(fields,/attendees|attachments/);
});
test('daily window refresh drops old snapshot and repeats bounded full query',async()=>{
 let url;const result=await mod.syncCalendar({calendarId:'c',now,accessToken:'t',previous:{events:[{id:'old'}],syncToken:'old',fullSyncedAt:now-86400001},fetchImpl:async u=>{url=String(u);return reply({items:[event],nextSyncToken:'fresh'});}});
 assert.match(url,/timeMin=/);assert.doesNotMatch(url,/syncToken=old/);assert.deepEqual(result.events.map(e=>e.id),['a']);
});
test('429 preserves previous snapshot and bounded pagination stops looping tokens',async()=>{
 const previous={events:[{id:'old'}],syncToken:'old',fullSyncedAt:now};await assert.rejects(mod.syncCalendar({calendarId:'c',now,accessToken:'t',previous,fetchImpl:async()=>reply({},429)}),{code:'CALENDAR_TEMPORARY_FAILURE'});assert.equal(previous.syncToken,'old');
 let calls=0;await assert.rejects(mod.syncCalendar({calendarId:'c',now,accessToken:'t',fetchImpl:async()=>{calls++;return reply({items:[],nextPageToken:'loop'});}}),{code:'CALENDAR_LIMIT_EXCEEDED'});assert.equal(calls,50);
});
test('invalid dates fail with a safe error rather than a runtime exception',async()=>{
 await assert.rejects(mod.syncCalendar({calendarId:'c',now,accessToken:'t',fetchImpl:async()=>reply({items:[{...event,start:{date:'2026-99-99'}}],nextSyncToken:'s'})}),{code:'CALENDAR_INVALID_RESPONSE'});
});
test('incremental cancellation removes event and omits incompatible time bounds', async()=>{
  assert.equal(typeof mod.syncCalendar,'function'); let url;
  const previous={events:[{id:'a'}],syncToken:'old',fullSyncedAt:now,window:mod.syncWindow(now)};
  const result=await mod.syncCalendar({calendarId:'c',previous,accessToken:'t',now,fetchImpl:async u=>{url=String(u);return reply({items:[{id:'a',status:'cancelled'}],nextSyncToken:'new'});}});
  assert.deepEqual(result.events,[]); assert.doesNotMatch(url,/timeMin|timeMax/); assert.match(url,/syncToken=old/); assert.equal(previous.events.length,1);
});
test('second page failure never mutates previous cache',async()=>{
  assert.equal(typeof mod.syncCalendar,'function'); const previous={events:[{id:'a'}],syncToken:'old',fullSyncedAt:now,window:mod.syncWindow(now)};let calls=0;
  await assert.rejects(mod.syncCalendar({calendarId:'c',previous,now,accessToken:'t',fetchImpl:async()=>++calls===1?reply({items:[],nextPageToken:'p'}):reply({},503)}),{code:'CALENDAR_TEMPORARY_FAILURE'});
  assert.equal(previous.syncToken,'old'); assert.equal(previous.events.length,1);
});
test('expired sync token rebuilds full snapshot',async()=>{
  assert.equal(typeof mod.syncCalendar,'function');let calls=0;
  const result=await mod.syncCalendar({calendarId:'c',now,previous:{events:[],syncToken:'old',fullSyncedAt:now},accessToken:'t',fetchImpl:async()=>++calls===1?reply({},410):reply({items:[event],nextSyncToken:'new'})});
  assert.equal(result.events.length,1);assert.equal(calls,2);
});
