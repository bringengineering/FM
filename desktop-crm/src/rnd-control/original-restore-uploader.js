const {createHash}=require('node:crypto'),{assertUploadFile}=require('./file-policy');
const key=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x),hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),sha=x=>createHash('sha256').update(x).digest('hex');
/** Trusted Main coordinator only. journal.begin must durably reserve once; authorize/check must enforce fresh approval/session/root. No IPC. */
function createOriginalRestoreUploader({enabled=false,prepare,authorize,check,journal,upload}){
 let busy=false;
 return async input=>{
  if(!enabled)throw Error('원본 복원 업로드는 비활성 상태입니다');if(busy)throw Error('원본 복원 업로드가 진행 중입니다');busy=true;
  try{
   await check();const prepared=await prepare(input);await check();const incoming=prepared?.uploadPlan;
   if(incoming?.kind!=='BRING_RND_ORIGINAL_REUPLOAD_PREPARATION'||incoming.version!==1||incoming.cloudWrites!==false||incoming.canApply!==false||!key(incoming.previewId)||!hash(incoming.mappingSHA256)||!hash(incoming.sourceZipSHA256)||!Array.isArray(incoming.originals)||incoming.originals.length>1000)throw Error('복원 업로드 준비 오류');
   // Cap every input before copying; own the complete batch before the first external write.
   let total=0;const versions=new Set(),originals=incoming.originals.map(item=>{
    const target=structuredClone(item.target),source=structuredClone(item.source);if(![target?.projectId,target?.artifactId,target?.versionId,source?.providerFileId].every(key)||!hash(target.sha256)||!(item.bytes instanceof Uint8Array)||item.bytes.byteLength!==target.sizeBytes||sha(item.bytes)!==target.sha256)throw Error('복원 원본 바이트·대상 검증 실패');
    total+=item.bytes.byteLength;if(total>100*1024*1024)throw Error('복원 업로드 용량 제한');const id=target.projectId+':'+target.artifactId+':'+target.versionId;if(versions.has(id))throw Error('복원 업로드 중복 버전');versions.add(id);assertUploadFile({fileName:item.fileName,sizeBytes:target.sizeBytes,bytes:item.bytes});
    return{source,target,fileName:item.fileName,mimeType:item.mimeType??'application/octet-stream',bytes:Buffer.from(item.bytes)};
   });
   const binding={previewId:incoming.previewId,mappingSHA256:incoming.mappingSHA256,sourceZipSHA256:incoming.sourceZipSHA256},approval=structuredClone(await authorize({...binding}));await check();
   if(approval?.approved!==true||!key(approval.actorUid)||Object.keys(binding).some(k=>approval[k]!==binding[k]))throw Error('현재 복원 업로드 승인 확인이 필요합니다');
   const attemptId=await journal.begin({...binding,actorUid:approval.actorUid,files:originals.map(({source,target})=>({sourceProviderFileId:source.providerFileId,target}))});if(!key(attemptId))throw Error('복원 업로드 예약 기록 오류');await check();
   const receipts=[];
   for(const item of originals){
    await check();const context={sourceProviderFileId:item.source.providerFileId,...item.target};await journal.append(attemptId,{type:'UPLOAD_STARTED',...context});await check();let result;
    try{result=await upload({...item.target,fileName:item.fileName,mimeType:item.mimeType,bytes:item.bytes});}
    catch(error){const ref=error.recoveryRecord,recovery={};if(ref&&key(ref.providerFileId??ref.id)&&ref.projectId===item.target.projectId&&ref.artifactId===item.target.artifactId&&ref.versionId===item.target.versionId&&(ref.sha256??ref.hash)===item.target.sha256&&(ref.sizeBytes??ref.size)===item.target.sizeBytes&&typeof ref.observedAt==='string'&&Number.isFinite(Date.parse(ref.observedAt))){recovery.providerFileId=ref.providerFileId??ref.id;recovery.observedAt=ref.observedAt;}await journal.append(attemptId,{type:'UPLOAD_UNCERTAIN',...context,...recovery});throw error;}
    // Preserve completion for the initiating attempt even if logout occurred while Drive was returning.
    if(!key(result?.providerFileId)||['artifactId','versionId','sha256','sizeBytes'].some(k=>result[k]!==item.target[k])||typeof result.verifiedAt!=='string'||!Number.isFinite(Date.parse(result.verifiedAt))){await journal.append(attemptId,{type:'UPLOAD_UNCERTAIN',...context});throw Error('Drive 복원 원본 완료 검증 실패');}
    const receipt={...context,providerFileId:result.providerFileId,verifiedAt:result.verifiedAt};await journal.append(attemptId,{type:'UPLOAD_VERIFIED',...receipt});receipts.push(receipt);await check();
   }
   await check();return{...binding,attemptId,receipts,databaseWrites:false,restoreReady:false};
  }finally{busy=false;}
 };
}
module.exports={createOriginalRestoreUploader};
