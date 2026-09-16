import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getDatabase} from 'firebase-admin/database';
import {createServerCSVRuntime} from './lib/rnd/csv-import-runtime.js';
if(process.env.FIREBASE_DATABASE_EMULATOR_HOST!=='127.0.0.1:9017'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9097')throw Error('Local demo Auth/DB emulator required');
const app=initializeApp({projectId:'demo-bring-rnd',databaseURL:'https://demo-bring-rnd.firebaseio.com'},'rnd-csv-callable-test');
const auth=getAuth(app),root=getDatabase(app).ref(),directory=await mkdtemp(join(tmpdir(),'bring-csv-callable-'));
const uid='csv-owner',email='csv-owner@test.invalid',password='fixture-'+randomUUID();
const runtime=createServerCSVRuntime(),require=createRequire(import.meta.url);
const {createCSVJobLedger}=require('./lib/rnd/csv-runtime/rnd-control/csv-job-ledger.js');
const {previewBaselineCSV}=await import('./lib/rnd/csv-runtime/rnd-control/csv-import.mjs');
async function login(address){const response=await fetch('http://127.0.0.1:9097/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:address,password,returnSecureToken:true}),signal:AbortSignal.timeout(10000)});const value=await response.json();assert.equal(response.ok,true);return value.idToken;}
async function call(data,token){const response=await fetch('http://127.0.0.1:5047/demo-bring-rnd/asia-southeast1/rndPublishCSVImport',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({data}),signal:AbortSignal.timeout(60000)});return{ok:response.ok,body:await response.json()};}
try{
 await auth.createUser({uid,email,password});await auth.createUser({uid:'csv-other',email:'csv-other@test.invalid',password});
 const token=await login(email),otherToken=await login('csv-other@test.invalid');
 const fields=['id','buildingId','date','operator','reason','serviceScope','costBasis','evidenceUrl','totalMinutes','travel','check','work','report','contact','other','labor','transport','materials','outsourcing'];
 const bytes=Buffer.from(fields.join(',')+'\n'+['a','b','2026-09-17','o','r','s','c','https://example.com','0',...Array(10).fill('0')].join(','));
 const preview=await previewBaselineCSV({bytes,mapping:Object.fromEntries(fields.map(k=>[k,k])),projectId:'p',projectIds:['p'],current:[],units:{minutes:'min',costs:'KRW'},source:{fileName:'source.csv',ledger:'origin',extractedAt:'2026-09-16T00:00:00.000Z'}});
 const job=await createCSVJobLedger(directory).create(uid,{bytes,preview,actorEmail:email});
 const audit=await runtime.buildAudit({job,projectRevision:1,publisher:{uid,email,role:'member',authTime:1,mustChangePassword:false},at:'2026-09-17T00:02:00.000Z',driveReference:{projectId:'p',artifactId:'csv-import-original',versionId:job.id,providerFileId:'file',sha256:job.source.sha256,sizeBytes:bytes.length,status:'VERIFIED',verifiedAt:'2026-09-17T00:01:00.000Z'}});
 const grant={enabled:true,email,role:'member'},otherGrant={enabled:true,email:'csv-other@test.invalid',role:'member'};
 const seed={crmCompany:{access:{[uid]:grant,'csv-other':otherGrant}},rndAccess:{[uid]:grant,'csv-other':otherGrant},rndControl:{projects:{p:{id:'p',revision:8}},importJobs:{[job.id]:audit},visits:{existing:{keep:true}}},other:{keep:true}};
 await root.set(seed);const input={job,providerFileId:'file',driveToken:'fixture-unused-no-google-request'};
 assert.equal((await call(input,null)).body.error.status,'UNAUTHENTICATED');
 assert.equal((await call([],token)).body.error.status,'INVALID_ARGUMENT');
 assert.deepEqual((await root.get()).val(),seed);console.log('PASS real CSV callable rejects anonymous and malformed requests without company mutation');
 const results=await Promise.all([call(input,token),call(input,token)]);
 for(const result of results){assert.equal(result.ok,true,JSON.stringify(result.body));assert.deepEqual(result.body.result,{id:job.id,projectId:'p',status:'RECORDED',contentSHA256:runtime.digest(audit)});}
 assert.deepEqual((await root.get()).val(),seed);console.log('PASS real Firebase Auth CSV callable concurrently confirms existing audit and preserves newer project/company data');
 assert.equal((await call(input,otherToken)).ok,false);assert.deepEqual((await root.get()).val(),seed);console.log('PASS different approved member cannot claim original owner CSV job');
 const collision={...input,providerFileId:'different-file'};assert.equal((await call(collision,token)).ok,false);assert.deepEqual((await root.get()).val(),seed);console.log('PASS actual CSV callable rejects source file collision without replacing audit');
 for(const [path,value] of [['rndAccess/'+uid+'/enabled',false],['crmCompany/access/'+uid+'/mustChangePassword',true],['rndAccess/'+uid+'/role','viewer']]){
  await root.set(seed);await root.child(path).set(value);const before=(await root.get()).val();assert.equal((await call(input,token)).body.error.status,'PERMISSION_DENIED');assert.deepEqual((await root.get()).val(),before);
 }
 console.log('PASS fresh actual SDK approval checks deny revoked access, password change and role mismatch');
 await root.set(seed);await auth.updateUser(uid,{disabled:true});assert.equal((await call(input,token)).body.error.status,'UNAUTHENTICATED');assert.deepEqual((await root.get()).val(),seed);console.log('PASS disabled real Auth account cannot replay existing CSV audit');
 console.log('SCOPE: actual Auth/Functions HTTP and Admin SDK existing-audit replay; seeded audit/Drive reference are fixtures, no original Google download or new publication verified');
}finally{await deleteApp(app);await rm(directory,{recursive:true,force:true});}
