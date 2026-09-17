const {createHash}=require('node:crypto');
const key=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x),hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
/** Main-internal plan only. Fresh authoritative preview/current IDs required; this grants no write approval. */
function createOriginalRestoreMapping(source,current,input){
 const preview=structuredClone(source),existing=structuredClone(current),request=structuredClone(input),fail=()=>{throw Error('원본 복원 대상 매핑·연결 오류');};
 if(preview?.kind!=='BRING_RND_ORIGINAL_RESTORE_PREVIEW'||preview.version!==1||preview.canApply!==false||!key(preview.previewId)||!hash(preview.sourceZipSHA256)||!hash(preview.currentSnapshotSHA256)||!request||Array.isArray(request)||Object.keys(request).sort().join(',')!=='importJobs,projects,visits')fail();
 const result={},maps={};
 for(const kind of ['projects','visits','importJobs']){
  const rows=preview[kind],ids=existing?.[kind],mapping=request[kind];if(!Array.isArray(rows)||rows.length>10000||!Array.isArray(ids)||ids.some(id=>!key(id))||new Set(ids).size!==ids.length||!mapping||typeof mapping!=='object'||Array.isArray(mapping)||Object.keys(mapping).length!==rows.length)fail();
  const sources=new Set(rows.map(row=>row?.id)),targets=Object.values(mapping);if(sources.size!==rows.length||Object.keys(mapping).some(id=>!sources.has(id))||targets.some(id=>!key(id)||ids.includes(id))||new Set(targets).size!==targets.length)fail();
  maps[kind]=new Map(Object.entries(mapping));result[kind]=rows.map(row=>{if(!key(row.id)||!hash(row.sourceSHA256))fail();const parent=kind==='projects'?row.id:row.projectId;if(parent!=null&&!maps.projects.has(parent))fail();return{sourceId:row.id,targetId:maps[kind].get(row.id),sourceProjectId:parent??null,targetProjectId:parent==null?null:maps.projects.get(parent),sourceSHA256:row.sourceSHA256};});
 }
 if(!Array.isArray(preview.originalPlan)||preview.originalPlan.length>1000)fail();const files=new Set();
 const originals=preview.originalPlan.map(ref=>{if(!key(ref.providerFileId)||files.has(ref.providerFileId)||!maps.projects.has(ref.projectId)||!key(ref.artifactId)||!key(ref.versionId)||!hash(ref.sha256)||!Number.isSafeInteger(ref.sizeBytes)||ref.sizeBytes<1||ref.sizeBytes>100*1024*1024)fail();files.add(ref.providerFileId);return{sourceProviderFileId:ref.providerFileId,sourceProjectId:ref.projectId,targetProjectId:maps.projects.get(ref.projectId),artifactId:ref.artifactId,sourceVersionId:ref.versionId,sha256:ref.sha256,sizeBytes:ref.sizeBytes,action:'REQUIRES_VERIFIED_REUPLOAD'};});
 const body={kind:'BRING_RND_ORIGINAL_RESTORE_MAPPING',version:1,previewId:preview.previewId,sourceZipSHA256:preview.sourceZipSHA256,currentSnapshotSHA256:preview.currentSnapshotSHA256,...result,originals,canApply:false,cloudWrites:false,originVerified:false,restoreReady:false};return{...body,mappingSHA256:createHash('sha256').update(JSON.stringify(body)).digest('hex')};
}
module.exports={createOriginalRestoreMapping};
