const {createHash}=require('node:crypto');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),digest=value=>sha(JSON.stringify(value));
const key=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const fields=['projectId','artifactId','versionId','providerFileId','sha256','sizeBytes'];
/** Main-internal only: consumes a trusted verified source and fresh mapping. No upload or execution approval. */
async function prepareRestoreOriginals({source,mapping:inputMapping},{check}){
 const mapping=structuredClone(inputMapping);await check();const fail=()=>{throw Error('복원 원본·대상 연결 검증 실패');};
 if(mapping?.kind!=='BRING_RND_ORIGINAL_RESTORE_MAPPING'||mapping.version!==1||mapping.canApply!==false||mapping.cloudWrites!==false||mapping.restoreReady!==false||!key(mapping.previewId)||!Array.isArray(mapping.originals)||mapping.originals.length>1000)fail();
 const {mappingSHA256,...body}=mapping;if(digest(body)!==mappingSHA256)fail();
 if(source?.manifest?.kind!=='BRING_RND_ENUMERATED_ORIGINAL_PACKAGE'||source.manifest.version!==1||source.restoreReady!==false||source.cloudWrites!==false||!Array.isArray(source.manifest.files)||!(source.originals instanceof Map)||source.originals.size!==mapping.originals.length||source.manifest.files.length!==mapping.originals.length||digest(source.metadata)!==source.manifest.metadataSHA256)fail();
 const projects=new Map();
 for(const kind of ['projects','visits','importJobs']){
  const rows=source.metadata?.[kind],plans=mapping[kind];if(!Array.isArray(rows)||!Array.isArray(plans)||rows.length!==plans.length||rows.length>10000)fail();
  const byId=new Map(rows.map(row=>[row.id,row])),targets=new Set();if(byId.size!==rows.length)fail();
  for(const plan of plans){const row=byId.get(plan.sourceId);if(!row||!key(plan.sourceId)||!key(plan.targetId)||targets.has(plan.targetId)||digest(row)!==plan.sourceSHA256)fail();targets.add(plan.targetId);byId.delete(plan.sourceId);
   const parent=kind==='projects'?row.id:row.projectId??null;if(plan.sourceProjectId!==parent)fail();
   if(kind==='projects'){if(plan.targetProjectId!==plan.targetId)fail();projects.set(plan.sourceId,plan.targetId);}else if(plan.targetProjectId!==(parent==null?null:projects.get(parent)))fail();
  }
 }
 const inventory=new Map(source.manifest.files.map(ref=>[ref.providerFileId,ref]));if(inventory.size!==mapping.originals.length)fail();
 const originals=[];let total=0;
 for(const plan of mapping.originals){
  await check();const ref=inventory.get(plan.sourceProviderFileId);if(!ref||plan.action!=='REQUIRES_VERIFIED_REUPLOAD'||ref.path!=='originals/'+ref.providerFileId+'.bin'||plan.sourceProjectId!==ref.projectId||plan.targetProjectId!==projects.get(ref.projectId)||plan.artifactId!==ref.artifactId||plan.sourceVersionId!==ref.versionId||plan.sha256!==ref.sha256||plan.sizeBytes!==ref.sizeBytes||!fields.slice(0,4).every(field=>key(ref[field])))fail();inventory.delete(ref.providerFileId);
  const bytes=source.originals.get(ref.path);if(!(bytes instanceof Uint8Array)||!Number.isSafeInteger(ref.sizeBytes)||ref.sizeBytes<1||bytes.byteLength!==ref.sizeBytes||sha(bytes)!==ref.sha256)fail();total+=bytes.byteLength;if(total>100*1024*1024)fail();
  // IDs are stable within this reviewed mapping and distinct from archival IDs. Multiple versions share their new artifact.
  const id=(type,parts)=>'restored_'+sha(JSON.stringify([type,mappingSHA256,...parts]));
  const target={projectId:plan.targetProjectId,artifactId:id('artifact',[ref.projectId,ref.artifactId]),versionId:id('version',[ref.projectId,ref.artifactId,ref.versionId,ref.providerFileId]),sha256:ref.sha256,sizeBytes:ref.sizeBytes};
  originals.push({source:Object.fromEntries(fields.map(field=>[field,ref[field]])),target,fileName:ref.fileName??null,mimeType:ref.mimeType??null,requiresFileName:ref.fileName===undefined,bytes:Buffer.from(bytes)});
 }
 if(inventory.size)fail();await check();
 return{kind:'BRING_RND_ORIGINAL_REUPLOAD_PREPARATION',version:1,previewId:mapping.previewId,mappingSHA256,sourceZipSHA256:mapping.sourceZipSHA256,originals,canApply:false,cloudWrites:false,restoreReady:false,originVerified:false};
}
module.exports={prepareRestoreOriginals};
