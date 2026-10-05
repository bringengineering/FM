import Core from '../../desktop-crm/src/weekly-report-delivery-core.js';

const DB='https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app';
const MAX_PDF=2*1024*1024, MAX_BODY=3*1024*1024;
const fail=(code='INVALID_INPUT')=>{throw Object.assign(new Error(code),{code});};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function boundedJson(response,limit=65536) {
  if(Number(response.headers.get('content-length'))>limit) fail('INPUT_TOO_LARGE');
  const reader=response.body?.getReader(); if(!reader) fail();
  let size=0;const chunks=[];
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail('INPUT_TOO_LARGE');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail();}
}
export async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),x=>x.toString(16).padStart(2,'0')).join('');
}
export function pdfBytes(value) {
  if(typeof value!=='string'||value.length>Math.ceil(MAX_PDF/3)*4||! /^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail();
  let raw;try{raw=atob(value);}catch{fail();}
  if(raw.length<100||raw.length>MAX_PDF||!/^%PDF-1\.[0-9]/.test(raw)||!raw.slice(-1024).includes('%%EOF')||/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b/.test(raw))fail();
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function readRecord(path,token,fetchImpl) {
  const url=new URL(`${DB}/crmCompany/${path}.json`);url.searchParams.set('auth',token);
  // Edge fetch supports follow/manual only; never follow a token-bearing URL.
  let response;try{response=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(10000)});}catch{fail('DELIVERY_UNAVAILABLE');}
  if([401,403].includes(response.status))fail('FORBIDDEN');
  if(!response.ok)fail('DELIVERY_UNAVAILABLE');
  return boundedJson(response,65536);
}
export async function weeklyDeliveryRequest(request,env,{verifyIdentity,fetchImpl=fetch,rateLimit}={}) {
  try {
    if(request.method!=='POST')return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);
    const token=/^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization')||'')?.[1];
    if(!token)fail('AUTH_REQUIRED');
    const identity=await verifyIdentity(token);
    if(!identity.emailVerified||! /^[A-Za-z0-9_-]{1,128}$/.test(identity.uid||''))fail('FORBIDDEN');
    await rateLimit(identity);
    const access=await readRecord(`access/${identity.uid}`,token,fetchImpl);
    if(access?.enabled!==true||access.mustChangePassword===true||!['admin','member'].includes(access.role)||(access.role!=='admin'&&access.marketingRole==='marketing')||String(access.email||'').trim().toLowerCase()!==identity.email.toLowerCase())fail('FORBIDDEN');
    if(!env.WEEKLY_REPORT_DELIVERIES)fail('DELIVERY_UNAVAILABLE');
    const input=await boundedJson(request,MAX_BODY);
    if(!input||!['send','status','retry'].includes(input.action)||!/^weekly_report_[A-Za-z0-9._-]{1,66}$/.test(input.id||'')||Object.keys(input).some(k=>!['action','id','snapshot','pdf','mimeType','confirmMissing'].includes(k))||(input.confirmMissing!==undefined&&(input.action!=='retry'||typeof input.confirmMissing!=='boolean')))fail();
    const record=await readRecord(`growthCheckins/${identity.uid}/${input.id}`,token,fetchImpl);
    const reference=Core.reference(record,identity.uid), referenceHash=await digest(reference);
    const command={action:input.action,referenceHash,updatedAt:record.updatedAt,confirmMissing:input.confirmMissing===true};
    if(input.action==='send'){
      if(input.mimeType!=='application/pdf')fail();pdfBytes(input.pdf);
      command.report=Core.snapshot(input.snapshot,record,identity.uid);
      command.pdf=input.pdf;
      command.fingerprint=await digest({reference,report:command.report});
    }
    const stub=env.WEEKLY_REPORT_DELIVERIES.get(env.WEEKLY_REPORT_DELIVERIES.idFromName(`${identity.uid}:${input.id}`));
    return await stub.fetch(new Request('https://weekly-report-internal/command',{method:'POST',body:JSON.stringify(command)}));
  }catch(error){
    const code=['AUTH_REQUIRED','FORBIDDEN','INVALID_INPUT','INPUT_TOO_LARGE','RATE_LIMITED'].includes(error?.code)?error.code:'DELIVERY_UNAVAILABLE';
    return json({ok:false,code},({AUTH_REQUIRED:401,FORBIDDEN:403,INVALID_INPUT:400,INPUT_TOO_LARGE:413,RATE_LIMITED:429})[code]||503);
  }
}

// One Durable Object per author/report. Persist the claim before contacting
// Telegram; a timeout/crash remains uncertain, never an automatic duplicate.
export class WeeklyReportDeliveries {
  constructor(state,env){this.storage=state.storage;this.env=env;this.queue=Promise.resolve();this.fetchImpl=fetch.bind(globalThis);}
  fetch(request){const result=this.queue.then(()=>this.command(request));this.queue=result.catch(()=>{});return result;}
  async command(request){
    try{
      const input=await boundedJson(request,MAX_BODY);
      if(!['send','status','retry'].includes(input.action)||! /^[a-f0-9]{64}$/.test(input.referenceHash||''))fail();
      let current=await this.storage.get('current');
      if(input.action==='status')return json({ok:true,...(current?.referenceHash===input.referenceHash||['unknown','sending'].includes(current?.status)?this.publicStatus(current):{status:'none'})});
      if(input.action==='retry'){
        if(current&&['unknown','sending'].includes(current.status)&&input.confirmMissing===true){
          // Explicit human acknowledgement after checking the work room. This
          // is never scheduled or inferred from an ordinary retry/submission.
          current.status=current.referenceHash===input.referenceHash?'failed':'none';
          current.retryAt=0;current.confirmedMissingAt=new Date().toISOString();
          await this.storage.put('current',current);
          if(current.status==='none'){await this.clearPdf();return json({ok:true,status:'none'});}
        }
        if(!current||current.referenceHash!==input.referenceHash)return json({ok:true,status:'none'});
        if(current.status!=='failed')return json({ok:true,...this.publicStatus(current)});
        if(current.retryAt>Date.now())return json({ok:true,...this.publicStatus(current)});
        return this.deliver(current);
      }
      if(!/^[a-f0-9]{64}$/.test(input.fingerprint||''))fail();
      if(current?.status==='sending'||current?.status==='unknown')return json({ok:true,status:'unknown'});
      if(current?.updatedAt>input.updatedAt)return json({ok:false,code:'STALE_REPORT'},409);
      const previous=await this.storage.get(`sent:${input.fingerprint}`);
      if(previous){await this.storage.put('current',previous);return json({ok:true,...this.publicStatus(previous)});}
      if(current?.fingerprint===input.fingerprint&&current.status==='failed')return json({ok:true,...this.publicStatus(current)});
      if((await this.storage.list({prefix:'sent:',limit:100})).size>=100)return json({ok:false,code:'DELIVERY_LIMIT'},429);
      pdfBytes(input.pdf);
      // PDF chunks stay only until successful delivery; no personal data in logs.
      await this.clearPdf();
      const chunks={};for(let i=0;i<input.pdf.length;i+=60000)chunks[`pdf:${String(i/60000).padStart(3,'0')}`]=input.pdf.slice(i,i+60000);
      await this.storage.put(chunks);
      current={referenceHash:input.referenceHash,fingerprint:input.fingerprint,updatedAt:input.updatedAt,report:input.report,status:'failed',attempts:0};
      await this.storage.put('current',current);
      await this.storage.setAlarm(Date.now()+7*24*60*60*1000);
      return this.deliver(current);
    }catch{return json({ok:false,code:'DELIVERY_UNAVAILABLE'},503);}
  }
  publicStatus(record){return {status:record.status==='sending'?'unknown':record.status,sentAt:record.sentAt||'',retryAt:record.retryAt||0};}
  alarm(){const result=this.queue.then(async()=>{await this.clearPdf();const record=await this.storage.get('current');if(record?.report){delete record.report;if(record.status==='failed')record.status='none';await this.storage.put('current',record);}});this.queue=result.catch(()=>{});return result;}
  async clearPdf(){const keys=await this.storage.list({prefix:'pdf:'});if(keys.size)await this.storage.delete([...keys.keys()]);}
  async deliver(record){
    const token=this.env.WEEKLY_REPORT_TELEGRAM_BOT_TOKEN,chat=this.env.WEEKLY_REPORT_TELEGRAM_CHAT_ID;
    if(!/^\d{6,12}:[A-Za-z0-9_-]{30,50}$/.test(token||'')||!/^-[0-9]{5,20}$/.test(chat||''))return json({ok:true,status:'failed'});
    if(Date.now()-(record.attemptWindowAt||0)>=3600000){record.attempts=0;record.attemptWindowAt=Date.now();}
    if((record.attempts||0)>=10)return json({ok:true,status:'failed',retryAt:record.attemptWindowAt+3600000});
    if(record.retryAt>Date.now())return json({ok:true,...this.publicStatus(record)});
    const chunks=await this.storage.list({prefix:'pdf:'});if(!chunks.size)return json({ok:true,status:'none'});
    const bytes=pdfBytes([...chunks.values()].join(''));
    const form=new FormData();form.set('chat_id',chat);form.set('caption',Core.caption(record.report));
    form.set('document',new Blob([bytes],{type:'application/pdf'}),Core.fileName(record.report));form.set('disable_content_type_detection','true');
    record={...record,status:'sending',attempts:(record.attempts||0)+1};
    await this.storage.put('current',record);
    try{
      const response=await this.fetchImpl(`https://api.telegram.org/bot${token}/sendDocument`,{method:'POST',body:form,redirect:'manual',signal:AbortSignal.timeout(25000)});
      const result=await boundedJson(response,65536);
      if(response.ok&&result.ok===true&&Number.isSafeInteger(result.result?.message_id)){
        record={...record,status:'sent',sentAt:new Date().toISOString()};delete record.report;
        await this.storage.put({current:record,[`sent:${record.fingerprint}`]:record});await this.clearPdf();
        return json({ok:true,...this.publicStatus(record)});
      }
      // Only explicit Telegram rejection is safe to retry. An invalid response
      // or transport failure might already have delivered the document.
      record.status=result.ok===false&&[400,401,403,404,413,429].includes(response.status)?'failed':'unknown';
      record.retryAt=Date.now()+Math.min(3600,Math.max(30,Number(result.parameters?.retry_after)||30))*1000;
    }catch{record.status='unknown';}
    await this.storage.put('current',record);
    return json({ok:true,...this.publicStatus(record)});
  }
}
