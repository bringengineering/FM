const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
function normalize(input){
 const value={operationId:input?.operationId,collection:input?.collection,recordId:input?.recordId,revision:input?.revision,contentSHA256:input?.contentSHA256,at:input?.at};
 if(!validId(value.operationId)||!validId(value.recordId)||!['projects','visits'].includes(value.collection)||!Number.isInteger(value.revision)||value.revision<1||!/^[a-f0-9]{64}$/.test(value.contentSHA256??'')||typeof value.at!=='string'||!Number.isFinite(Date.parse(value.at)))throw Error('저장 작업 기록 형식 오류');
 return value;
}
function createSaveLedger(directory){
 const root=path.resolve(directory);let tail=Promise.resolve();
 const serial=work=>{const result=tail.then(work);tail=result.catch(()=>{});return result;};
 const target=uid=>{if(!validId(uid))throw Error('저장 작업 UID 오류');return path.join(root,uid+'.json');};
 async function read(uid){
  try{
   const file=target(uid);if((await fs.stat(file)).size>2*1024*1024)throw Error('저장 작업 기록 용량 한도');
   const raw=JSON.parse(await fs.readFile(file,'utf8'));
   if(raw.kind!=='BRING_RND_SAVE_ATTEMPTS'||raw.uid!==uid||!Array.isArray(raw.records)||raw.records.length>2000)throw Error('저장 작업 원장 오류');
   const records=raw.records.map(normalize);if(new Set(records.map(x=>x.operationId)).size!==records.length)throw Error('중복 저장 작업 ID');return records;
  }catch(error){if(error.code==='ENOENT')return [];throw error;}
 }
 return{list:uid=>serial(()=>read(uid)),record:(uid,input)=>serial(async()=>{
  const file=target(uid),record=normalize(input),records=await read(uid),old=records.find(x=>x.operationId===record.operationId);
  if(old){if(JSON.stringify(old)!==JSON.stringify(record))throw Error('동일 저장 작업 ID 충돌');return old;}
  if(records.length>=2000)throw Error('저장 작업 원장 한도 · 기록 검토 필요');
  records.push(record);await fs.mkdir(root,{recursive:true});const temporary=file+'.'+randomUUID()+'.partial';
  try{await fs.writeFile(temporary,JSON.stringify({kind:'BRING_RND_SAVE_ATTEMPTS',uid,records}),{flag:'wx',mode:0o600});await fs.rename(temporary,file);}
  finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return record;
 })};
}
module.exports={createSaveLedger};
