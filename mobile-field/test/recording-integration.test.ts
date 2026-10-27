import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { CompanyRecordingApi } from '../src/api/recording';
import { SyncRunner } from '../src/domain/sync';
import { confirmVisit } from '../src/domain/model';
import { handleRecording } from '../../functions/src/field-mobile/recording-http';
import type { RecordingDependencies } from '../../functions/src/field-mobile/recording-service';
import { makeVault, visit, photo, jpeg } from './helpers';

// Production mobile client, SQLite queue and production HTTP/service over loopback.
// Identity, Drive, JPEG decoding and PDF generation below are synthetic doubles.
it('reconciles a customer visit, uploads, edits a caption and archives once through the real protocol',async()=>{
  const {vault}=await makeVault(),data=new Map<string,any>(),blobs=new Map<string,Buffer>(),files=new Map<string,Buffer>(),documents=new Map<string,any>();let ids=0;
  const recording:RecordingDependencies={
    store:{async get(p){return data.get(p)||null;},async change(p,fn){const next=fn(data.get(p)||null);data.set(p,structuredClone(next));return next;},async commit(report,doc){documents.set(String(doc.id),{report,doc});}},
    blobs:{async putOnce(p,b){if(!blobs.has(p))blobs.set(p,b);return blobs.get(p)!;},async read(p){return blobs.get(p)!;}},
    drive:{async checkRoots(){},async generateId(){return `drive-file-${++ids}`;},async folder(){return 'folder-test';},async upload(id,_parent,_name,_mime,b){files.set(id,b);},async download(id){return files.get(id)!;}},
    sites:{async listCustomers(){return[];},async readCustomer(id){return{id,name:'Synthetic customer',address:'Synthetic address',phone:'01000000000'};}},
    async recheck(){},async validateJpeg(){},async pdf(){return Buffer.from('%PDF-1.7\nSynthetic only');},
  };
  const auth={projectId:'test-company',allowedNativeAppIds:['native-test'],async verifyIdentity(){return{uid:'staff-a',aud:'test-company',iss:'https://securetoken.google.com/test-company',email:'staff@example.invalid',email_verified:true,firebase:{sign_in_provider:'password'}};},async verifyAppCheck(){return{app_id:'native-test'};},async readAccess(){return{enabled:true,email:'staff@example.invalid',role:'member'};}};
  const server=createServer(async(req,res)=>{try{const parts:Buffer[]=[];for await(const p of req)parts.push(Buffer.from(p));const result=await handleRecording({method:req.method!,url:req.url!,authorization:String(req.headers.authorization||''),appCheck:String(req.headers['x-firebase-appcheck']||''),contentType:String(req.headers['content-type']||''),range:String(req.headers['content-range']||''),idempotencyKey:String(req.headers['idempotency-key']||''),body:Buffer.concat(parts)},{auth,allowRequest:()=>true,recording:()=>recording});res.writeHead(result.status,{'content-type':'application/json'});res.end(JSON.stringify(result.body));}catch{res.writeHead(500);res.end();}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;
  const api=new CompanyRecordingApi('https://field-test.invalid/v1/field-app','staff-a',async()=>({uid:'staff-a',idToken:'synthetic',appCheckToken:'synthetic'}),((url,options)=>fetch(String(url).replace('https://field-test.invalid',`http://127.0.0.1:${port}`),options)) as typeof fetch),signal=new AbortController().signal;
  try{
    const v=visit();v.job.customerId='customer-a';v.job.buildingId='';await vault.saveVisit(v,null);await vault.savePhoto(await photo(),jpeg,1);
    await api.recordingContext(signal);await api.storageStatus(signal);
    async function sync(){const s=await vault.load(),v=s.visits[0]!;const link=await api.reconcile(v,s.photos,signal);await vault.linkRevision(v.id,link.revision,link.photoIds);await new SyncRunner(vault,api,v.id).run();}
    await sync();let state=await vault.load();expect(state.photos[0]?.state).toBe('ready');
    await vault.editPhoto({...state.photos[0]!,caption:'Revised caption'},state.visits[0]!.revision);state=await vault.load();await vault.saveVisit(confirmVisit(state.visits[0]!),state.visits[0]!.revision);
    await sync();const current=(await vault.load()).visits[0]!;const receipt=await api.archive(current,signal);expect(await api.archive(current,signal)).toEqual(receipt);
    expect(files.size).toBe(2);expect(documents.size).toBe(1);const record=documents.get(receipt.documentId);expect(record.report.customerId).toBe('customer-a');expect(record.report.buildingId).toBe('');expect(record.report.items[0].before[0].caption).toBe('Revised caption');
  }finally{await vault.close();server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
