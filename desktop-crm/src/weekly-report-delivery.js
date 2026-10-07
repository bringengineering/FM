'use strict';
const Core=require('./weekly-report-delivery-core');
const ENDPOINT='https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/weekly-report-delivery';
const failure=()=>({status:'failed'});
const error=()=>Object.assign(new Error('주간보고서 제출 내용을 다시 확인해 주세요.'),{code:'INVALID_INPUT'});
function createWeeklyDeliveryService({remote,store,createPdf,fetchImpl=fetch}) {
  async function request(input,guard){
    const token=await remote.ensureIdToken(false);remote.assertSessionGuardActive(guard);
    const response=await fetchImpl(ENDPOINT,{method:'POST',redirect:'error',signal:AbortSignal.timeout(35000),headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(input)});
    if(!response.ok)throw error();
    const reader=response.body.getReader();let bytes=0,text='';const decoder=new TextDecoder();
    try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>16384){await reader.cancel();throw error();}text+=decoder.decode(next.value,{stream:true});}}
    finally{reader.releaseLock();}
    const result=JSON.parse(text+decoder.decode());remote.assertSessionGuardActive(guard);
    if(result.ok!==true||!['none','sent','failed','unknown'].includes(result.status))throw error();
    return {status:result.status,sentAt:String(result.sentAt||'').slice(0,40),retryAt:Number(result.retryAt)||0};
  }
  function session(){const value=remote.requireOfficeSession();if(!['admin','member'].includes(value.role))throw error();return value;}
  async function saved(id,uid,guard){
    if(!/^weekly_report_[A-Za-z0-9._-]{1,66}$/.test(id||''))throw error();
    const record=await remote.dbRequest(`growthCheckins/${uid}/${id}`,{method:'GET'});remote.assertSessionGuardActive(guard);Core.reference(record,uid);return record;
  }
  async function deliver(record,snapshot,guard){
    const pdf=await createPdf(snapshot);remote.assertSessionGuardActive(guard);
    if(!Buffer.isBuffer(pdf)||pdf.length>2*1024*1024)throw error();
    const result=await request({action:'send',id:record.id,snapshot,pdf:pdf.toString('base64'),mimeType:'application/pdf'},guard).catch(()=>({status:'unavailable'}));
    if(result.status==='sent')await store.remove(record.uid,record.id);
    return result;
  }
  return {
    async submit(input){
      const user=session(),guard=remote.captureSessionGuard();
      const checkin={...input?.checkin,uid:user.uid,name:user.displayName||user.email||''};
      const snapshot=Core.snapshot(input?.snapshot,checkin,user.uid);
      const record=await remote.saveGrowthCheckin(checkin);remote.assertSessionGuardActive(guard);
      let delivery;
      try{
        // Retain the exact approved snapshot, not re-collected live CRM data.
        await store.put(user.uid,record.id,{record:Core.reference(record,user.uid),snapshot});remote.assertSessionGuardActive(guard);
        delivery=await deliver(record,Core.snapshot(snapshot,record,user.uid),guard);
      }catch{delivery=failure();}
      remote.assertSessionGuardActive(guard);
      return {saved:true,delivery};
    },
    async status(input){
      const user=session(),guard=remote.captureSessionGuard();
      const record=await saved(input?.id,user.uid,guard);
      try{
        let result=await request({action:'status',id:record.id},guard);
        if(result.status==='none'){
          const pending=await store.get(user.uid,record.id);remote.assertSessionGuardActive(guard);
          if(pending&&JSON.stringify(pending.record)===JSON.stringify(Core.reference(record,user.uid)))result=failure();
        }
        return result;
      }catch{return {status:'unavailable'};}
    },
    async retry(input){
      const user=session(),guard=remote.captureSessionGuard();
      const record=await saved(input?.id,user.uid,guard);
      try{
        let result=await request({action:'retry',id:record.id,confirmMissing:input?.confirmMissing===true},guard);
        if(result.status==='none'){
          const pending=await store.get(user.uid,record.id);remote.assertSessionGuardActive(guard);
          if(!pending||JSON.stringify(pending.record)!==JSON.stringify(Core.reference(record,user.uid)))return {status:'none'};
          result=await deliver(record,Core.snapshot(pending.snapshot,record,user.uid),guard);
        }
        if(result.status==='sent')await store.remove(user.uid,record.id);
        return result;
      }catch{return {status:'unavailable'};}
    },
  };
}
module.exports={createWeeklyDeliveryService};
