import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../src/calendar/state.js').catch(()=>({}));
const scopes='openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly';
const reply=(v,status=200)=>new Response(JSON.stringify(v),{status});
function fixture() {
 assert.equal(typeof mod.CompanyCalendarState,'function');
 const values=new Map();const storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),delete:async k=>values.delete(k),setAlarm:async()=>{},deleteAlarm:async()=>{}};
 const env={CALENDAR_ENABLED:'true',CALENDAR_STATE:{},GOOGLE_CALENDAR_CLIENT_ID:'id',GOOGLE_CALENDAR_CLIENT_SECRET:'secret',GOOGLE_CALENDAR_COMPANY_EMAIL:'company@example.com',GOOGLE_CALENDAR_PUBLIC_ORIGIN:'https://calendar.example.com',CALENDAR_ENCRYPTION_KEY:btoa('x'.repeat(32)),CRM_ADMIN_EMAILS:'admin@example.com'};
 storage.transaction=async callback=>callback(storage);
 const control={email:'company@example.com',failSync:false,invalidGrant:false,scope:scopes,now:Date.parse('2026-09-13T00:00:00Z'),syncCalls:0};
 const fetchImpl=async(url,opt)=>{
  if(url.includes('/token')) return control.invalidGrant?reply({error:'invalid_grant'},400):reply({access_token:'access',refresh_token:'refresh',expires_in:3600,scope:control.scope});
  if(url.includes('/userinfo')) return reply({email:control.email,email_verified:true});
  if(url.includes('/calendarList')) return reply({items:[{id:'company@example.com',summary:'Company'},{id:'other',summary:'Other'}]});
  if(url.endsWith('/watch')) return reply({id:JSON.parse(opt.body).id,resourceId:'resource',expiration:String(Date.now()+86400000)});
  if(url.includes('/events?')) {control.syncCalls++;return control.failSync?reply({},503):reply({items:[{id:'a',summary:'Work',start:{date:'2026-09-13'},end:{date:'2026-09-14'}}],nextSyncToken:'sync'});}
  return reply({});
 };
 const state=new mod.CompanyCalendarState({storage},env,{fetchImpl,now:()=>control.now});
 const admin={email:'admin@example.com',emailVerified:true};
 const call=async(input,identity=admin)=>{const r=await state.fetch(new Request('https://internal/action',{method:'POST',body:JSON.stringify({input,identity})}));return {status:r.status,...await r.json()};};
 const connect=async()=>{const r=await call({action:'connect'});const url=new URL(r.authorizationUrl);return url;};
 const callback=async url=>{const r=await state.fetch(new Request('https://internal/callback?state='+url.searchParams.get('state')+'&code=code'));return r;};
 return {values,env,control,state,call,connect,callback};
}
test('OAuth state is PKCE, single use and stored refresh token encrypted',async()=>{
 const f=fixture();const url=await f.connect();assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.doesNotMatch(url.searchParams.get('scope'),/auth\/calendar(?:\s|$)/);
 assert.equal((await f.callback(url)).status,200);assert.equal((await f.callback(url)).status,400);
 assert.equal((await f.call({action:'status'})).status,'awaiting_selection');assert.doesNotMatch(JSON.stringify([...f.values]),/"refresh"/);
});
test('expired OAuth attempt cannot replace connection',async()=>{
 const f=fixture(),url=await f.connect();f.control.now+=600001;assert.equal((await f.callback(url)).status,400);assert.equal((await f.call({action:'status'})).status,'disconnected');
});
test('valid webhook is a hint only; alarm re-fetches selected Google events',async()=>{
 const f=fixture();await f.callback(await f.connect());await f.call({action:'select',calendarIds:['company@example.com'],shareConfirmed:true});const [w]=(await f.state.load()).watches;
 const r=await f.state.fetch(new Request('https://internal/webhook',{method:'POST',headers:{'x-goog-channel-id':w.id,'x-goog-resource-id':w.resourceId,'x-goog-channel-token':w.token,'x-goog-resource-state':'exists'},body:JSON.stringify({events:[{id:'injected'}]})}));
 assert.equal(r.status,200);assert.equal(f.control.syncCalls,1);await f.state.alarm();assert.equal(f.control.syncCalls,2);assert.equal((await f.call({action:'events',month:'2026-09'})).events[0].id,'a');
});
test('concurrent OAuth callbacks are serialized and only one succeeds',async()=>{
 const f=fixture(),url=await f.connect();const results=await Promise.all([f.callback(url),f.callback(url)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
});
test('disabled configuration prevents alarm Google access',async()=>{
 const f=fixture();await f.callback(await f.connect());await f.call({action:'select',calendarIds:['company@example.com'],shareConfirmed:true});f.env.CALENDAR_ENABLED='false';await f.state.alarm();assert.equal(f.control.syncCalls,1);
});
test('wrong Google account preserves existing connection and consumes state',async()=>{
 const f=fixture();await f.callback(await f.connect());f.control.email='wrong@example.com';const url=await f.connect();assert.equal((await f.callback(url)).status,400);
 assert.equal((await f.call({action:'status'})).accountEmail,'company@example.com');assert.equal((await f.callback(url)).status,400);
});
test('non-admin may read but cannot connect/select/sync/disconnect/list',async()=>{
 const f=fixture(),reader={email:'reader@example.com',emailVerified:true};
 assert.equal((await f.call({action:'status'},reader)).canManage,false);
 for(const action of ['connect','select','sync','disconnect','calendars']) assert.equal((await f.call({action},reader)).code,'FORBIDDEN');
});
test('failed first selection and unconfirmed sharing cannot replace published selection',async()=>{
 const f=fixture();await f.callback(await f.connect());
 assert.equal((await f.call({action:'select',calendarIds:['company@example.com']})).code,'CALENDAR_SHARE_CONFIRMATION_REQUIRED');
 await f.call({action:'select',calendarIds:['company@example.com'],shareConfirmed:true});f.control.failSync=true;
 assert.equal((await f.call({action:'select',calendarIds:['other'],shareConfirmed:true})).ok,false);
 assert.deepEqual((await f.call({action:'status'})).selectedCalendars,[{id:'company@example.com',name:'Company'}]);
 assert.equal((await f.call({action:'events',month:'2026-09'})).events.length,1);
});
test('webhook fails closed on bad channel secret and invalid_grant retains cache as reconnect',async()=>{
 const f=fixture();await f.callback(await f.connect());await f.call({action:'select',calendarIds:['company@example.com'],shareConfirmed:true});
 const result=await f.state.fetch(new Request('https://internal/webhook',{method:'POST',headers:{'x-goog-channel-id':'bad'}}));assert.equal(result.status,403);
 f.control.invalidGrant=true;await f.call({action:'sync'});assert.equal((await f.call({action:'status'})).status,'reconnect');assert.equal((await f.call({action:'events',month:'2026-09'})).events.length,1);
});
test('disconnect clears imported data and connection only',async()=>{
 const f=fixture();f.values.set('unrelated',{crm:'preserved'});await f.callback(await f.connect());await f.call({action:'disconnect'});
 assert.deepEqual(f.values.get('unrelated'),{crm:'preserved'});assert.equal((await f.call({action:'status'})).status,'disconnected');
});
test('Google canonical email scope is accepted but calendar write scopes are rejected',async()=>{
 const f=fixture();f.control.scope=scopes.replace('openid email','openid https://www.googleapis.com/auth/userinfo.email');assert.equal((await f.callback(await f.connect())).status,200);
 f.control.scope=scopes+' https://www.googleapis.com/auth/calendar';assert.equal((await f.callback(await f.connect())).status,400);
});
test('company cache enforces a total retained event limit before publication',async()=>{
 const f=fixture();await f.callback(await f.connect());const state=await f.state.load();
 const events=Array.from({length:6000},(_,i)=>({id:String(i),start:'2026-09-13',end:'2026-09-14',title:'old',calendarId:'one',allDay:true}));
 state.caches={one:{events,syncToken:'s',fullSyncedAt:Date.parse('2026-09-13T00:00:00Z'),window:{timeMin:'2026-06-01T00:00:00Z',timeMax:'2027-09-01T00:00:00Z'}},two:{events,syncToken:'s',fullSyncedAt:Date.parse('2026-09-13T00:00:00Z'),window:{timeMin:'2026-06-01T00:00:00Z',timeMax:'2027-09-01T00:00:00Z'}}};
 await assert.rejects(f.state.reconcile(state,[{id:'one'},{id:'two'}]),{code:'CALENDAR_LIMIT_EXCEEDED'});
 assert.deepEqual((await f.state.load()).selected,[]);
});
