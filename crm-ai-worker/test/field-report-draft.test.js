import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../src/index.js';
import { fieldReportFacts } from '../src/field-report-draft.js';

test('accepts only bounded catalog keys and numbers, never free-form customer text',()=>{
  assert.match(fieldReportFacts({kind:'common',areas:[{key:'entrance',before:1,during:0,after:1}]}),/작업 전 1장/);
  for(const input of [
    {kind:'common',areas:[{key:'entrance',before:1,during:0,after:1,caption:'private'}]},
    {kind:'common',areas:[{key:'unknown',before:1,during:0,after:1}]},
    {kind:'common',areas:[{key:'entrance',before:101,during:0,after:0}]},
    {kind:'common',areas:[{key:'entrance',before:1,during:0,after:0},{key:'entrance',before:1,during:0,after:0}]},
  ])assert.throws(()=>fieldReportFacts(input),/INVALID_INPUT/);
});

test('requires signed App Check plus a verified active employee and sends only counts to Gemini',async()=>{
  const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);Object.assign(jwk,{kid:'test-key',alg:'RS256',use:'sig'});
  const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  const header=enc({alg:'RS256',typ:'JWT',kid:'test-key'}),claims=enc({iss:'https://firebaseappcheck.googleapis.com/864976295990',aud:['projects/864976295990'],sub:'1:864976295990:android:644a2b7d5242a0b5eb6097',exp:Math.floor(Date.now()/1000)+300});
  const data=`${header}.${claims}`,sig=Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(data))).toString('base64url'),check=`${data}.${sig}`;
  const idToken=`${enc({alg:'RS256'})}.${enc({firebase:{sign_in_provider:'password'}})}.signature`;
  let access={enabled:true,role:'member',email:'employee@example.invalid'},geminiCalls=0;
  const fetchImpl=async(url,opts={})=>{
    if(String(url).includes('/v1/jwks'))return Response.json({keys:[jwk]});
    if(String(url).includes('accounts:lookup'))return Response.json({users:[{localId:'employee-1',email:access.email,emailVerified:true}]});
    if(String(url).includes('/crmCompany/access/'))return Response.json(access);
    if(String(url).includes(':generateContent')){geminiCalls++;const payload=JSON.parse(opts.body);assert.doesNotMatch(JSON.stringify(payload),/employee@example|data:image|caption/);return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({text:'구역별 현장 사진을 정리하여 전달드립니다.'})}]}}]});}
    throw Error('unexpected request');
  };
  const worker=createWorker({fetchImpl,requestId:()=> 'synthetic'}),env={AI_ENABLED:'true',FIREBASE_WEB_API_KEY:'public',GEMINI_API_KEY:'synthetic',AI_USAGE:{async get(){return '0';},async put(){}},AI_RATE_LIMITER:{async limit(){return{success:true};}}};
  const req=(app=check)=>new Request('https://unit.invalid/v1/field-report-draft',{method:'POST',headers:{authorization:`Bearer ${idToken}`,'x-firebase-appcheck':app,'content-type':'application/json'},body:JSON.stringify({kind:'common',areas:[{key:'entrance',before:1,during:0,after:1}]})});
  assert.equal((await worker.fetch(req('invalid'),env)).status,401);assert.equal(geminiCalls,0);
  access={...access,enabled:false};assert.equal((await worker.fetch(req(),env)).status,403);assert.equal(geminiCalls,0);
  access={...access,enabled:true};const response=await worker.fetch(req(),env);assert.equal(response.status,200);assert.equal((await response.json()).result.text,'구역별 현장 사진을 정리하여 전달드립니다.');assert.equal(geminiCalls,1);
});
