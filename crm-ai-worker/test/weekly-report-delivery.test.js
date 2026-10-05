import test from 'node:test';
import assert from 'node:assert/strict';
import W from '../../desktop-crm/src/weekly-report-core.js';
import {weeklyDeliveryRequest,WeeklyReportDeliveries,pdfBytes,digest} from '../src/weekly-report-delivery.js';
import {createWorker} from '../src/index.js';
const pdf=btoa('%PDF-1.7\n'+ 'test '.repeat(30)+'\n%%EOF');
const snapshot={summary:'테스트 주간보고',automatic:[{title:'점검 완료',detail:'점검 세부사항',source:'업무지시',status:'completed'}],manual:[],plans:[]};
const record={id:'weekly_report_2026-10-05_user',uid:'user',name:'테스트',week:'2026-10-05',updatedAt:'2026-10-05T00:00:00Z',answers:{done:W.serializeDone(snapshot),next:W.serializePlans([]),stuck:'NEVER_EXPORT',grow:'PRIVATE'}};
const identity={uid:'user',email:'member@example.test',emailVerified:true};
class Storage{constructor(){this.map=new Map();}async get(k){return structuredClone(this.map.get(k));}async put(k,v){if(typeof k==='object'){for(const [key,value]of Object.entries(k))this.map.set(key,structuredClone(value));}else this.map.set(k,structuredClone(v));}async list({prefix='',limit=1000}){return new Map([...this.map].filter(([k])=>k.startsWith(prefix)).sort().slice(0,limit));}async delete(keys){for(const k of Array.isArray(keys)?keys:[keys])this.map.delete(k);}async setAlarm(){}}
const internal=value=>new Request('https://weekly-report-internal/command',{method:'POST',body:JSON.stringify(value)});
async function harness(mode='success'){
 const storage=new Storage(),object=new WeeklyReportDeliveries({storage},{WEEKLY_REPORT_TELEGRAM_BOT_TOKEN:'123456:'+ 'x'.repeat(35),WEEKLY_REPORT_TELEGRAM_CHAT_ID:'-123456789'});let sends=0;
 object.fetchImpl=async(url,options)=>{sends++;assert.match(url,/^https:\/\/api.telegram.org\/bot/);assert.equal(options.redirect,'error');assert.equal(options.body.get('chat_id'),'-123456789');assert.match(options.body.get('document').name,/\.pdf$/);assert.equal(options.body.get('document').type,'application/pdf');assert.doesNotMatch(options.body.get('caption'),/NEVER_EXPORT|PRIVATE/);if(mode==='timeout')throw Error('timeout');if(mode==='reject')return Response.json({ok:false},{status:429});return Response.json({ok:true,result:{message_id:42}});};
 const command={action:'send',referenceHash:await digest('reference'),fingerprint:await digest('report'),updatedAt:record.updatedAt,report:{...snapshot,week:record.week,reporter:'테스트',department:'브링'},pdf};
 return {storage,object,command,sends:()=>sends};
}
test('PDF boundary rejects wrong data, executable actions, and oversized decoded file',()=>{
 assert.ok(pdfBytes(pdf).length>100);assert.throws(()=>pdfBytes(btoa('<html>not a pdf</html>')));assert.throws(()=>pdfBytes(btoa('%PDF-1.7\n/JavaScript '+ 'x'.repeat(150)+'%%EOF')));assert.throws(()=>pdfBytes('A'.repeat(3*1024*1024)));
});
test('simultaneous same report delivers exactly once and clears private PDF chunks',async()=>{
 const h=await harness();const replies=await Promise.all([h.object.fetch(internal(h.command)),h.object.fetch(internal(h.command))]);
 for(const reply of replies)assert.equal((await reply.json()).status,'sent');assert.equal(h.sends(),1);assert.equal((await h.storage.list({prefix:'pdf:'})).size,0);assert.equal((await h.storage.get('current')).report,undefined);
});
test('explicit rejection permits controlled retry; ambiguous timeout never blindly resends',async()=>{
 for(const mode of ['reject','timeout']){const h=await harness(mode);const first=await (await h.object.fetch(internal(h.command))).json();assert.equal(first.status,mode==='reject'?'failed':'unknown');await h.object.fetch(internal(h.command));await h.object.fetch(internal({...h.command,action:'retry'}));assert.equal(h.sends(),1);if(mode==='reject'){const current=await h.storage.get('current');current.retryAt=0;await h.storage.put('current',current);await h.object.fetch(internal({...h.command,action:'retry'}));assert.equal(h.sends(),2);}}
});
test('only canonical own weekly reports pass; every access role fails closed',async()=>{
 for(const role of ['admin','member','viewer','marketing',null]){
  let calls=0;const env={WEEKLY_REPORT_DELIVERIES:{idFromName:n=>n,get:()=>({fetch:async()=>{calls++;return Response.json({ok:true,status:'sent'});}})}};
  const fetchImpl=async url=>Response.json(String(url).includes('/access/')?{role,enabled:true,email:identity.email}:record);
  const response=await weeklyDeliveryRequest(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({action:'send',id:record.id,snapshot,pdf,mimeType:'application/pdf'})}),env,{fetchImpl,verifyIdentity:async()=>identity,rateLimit:async()=>{}});
  assert.equal(response.status,['admin','member'].includes(role)?200:403);assert.equal(calls,['admin','member'].includes(role)?1:0);
 }
});
test('uncertain delivery can only resume after explicit missing-file confirmation',async()=>{
 const h=await harness('timeout');await h.object.fetch(internal(h.command));
 await h.object.fetch(internal({...h.command,action:'retry'}));assert.equal(h.sends(),1);
 await h.object.fetch(internal({...h.command,action:'retry',confirmMissing:true}));assert.equal(h.sends(),2);
});
test('anonymous, unverified, disabled, password-change, foreign owner, private and arbitrary destination are denied',async()=>{
 for(const kind of ['anonymous','unverified','disabled','password','foreign','private','destination']){
  let forwarded=0;const env={WEEKLY_REPORT_DELIVERIES:{idFromName:n=>n,get:()=>({fetch:async()=>{forwarded++;return Response.json({ok:true});}})}};
  const fetchImpl=async url=>Response.json(String(url).includes('/access/')?{role:'member',enabled:kind!=='disabled',mustChangePassword:kind==='password',email:identity.email}:{...record,...(kind==='foreign'?{uid:'another'}:{}),...(kind==='private'?{answers:{done:'PRIVATE',next:'private'}}:{})});
  const input={action:'send',id:record.id,snapshot,pdf,mimeType:'application/pdf',...(kind==='destination'?{chatId:'-999999'}:{})};
  const response=await weeklyDeliveryRequest(new Request('https://example.test',{method:'POST',headers:kind==='anonymous'?{}:{authorization:'Bearer test'},body:JSON.stringify(input)}),env,{fetchImpl,verifyIdentity:async()=>({...identity,emailVerified:kind!=='unverified'}),rateLimit:async()=>{}});
  assert.ok(response.status>=400,kind);assert.equal(forwarded,0);
 }
});
test('weekly route checks canonical allowlist without consuming AI quota or allowing anonymous',async()=>{
 let forwarded=0;const worker=createWorker({fetchImpl:async url=>{
  if(String(url).startsWith('https://identitytoolkit.googleapis.com/'))return Response.json({users:[{localId:'user',email:identity.email,emailVerified:true}]});
  return Response.json(String(url).includes('/access/')?{role:'member',email:identity.email,enabled:true}:record);
 }});
 const env={FIREBASE_WEB_API_KEY:'public-test-key',CRM_ALLOWED_EMAILS:'another@example.test',AI_ENABLED:'false',AI_RATE_LIMITER:{limit:async()=>({success:true})},WEEKLY_REPORT_DELIVERIES:{idFromName:n=>n,get:()=>({fetch:async()=>{forwarded++;return Response.json({ok:true,status:'none'});}})}};
 const input={action:'status',id:record.id};
 const response=await worker.fetch(new Request('https://example.test/v1/weekly-report-delivery',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify(input)}),env);
 assert.equal(response.status,200);assert.equal(forwarded,1);
 const denied=await worker.fetch(new Request('https://example.test/v1/weekly-report-delivery',{method:'POST',body:JSON.stringify(input)}),env);assert.equal(denied.status,401);assert.equal(forwarded,1);
});
