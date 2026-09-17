const {createHash}=require('node:crypto'),{zipBinaryFiles}=require('./zip');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const key=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const bindingKeys=['projectId','artifactId','versionId','providerFileId','sha256','sizeBytes'];
/** Internal builder only: caller must authenticate, validate authoritative snapshot, and supply session checks/download. No IPC or cloud write. */
async function buildOriginalBackup(input,{check,download}){
 const snapshot=structuredClone(input);await check();
 if(!Array.isArray(snapshot?.projects)||!snapshot.projects.length||snapshot.projects.some(p=>!key(p?.id))||new Set(snapshot.projects.map(p=>p.id)).size!==snapshot.projects.length)throw Error('원본 백업 프로젝트 목록 오류');
 const metadata=Buffer.from(JSON.stringify(snapshot));if(metadata.length>20*1024*1024)throw Error('백업 metadata 용량 제한');
 const projects=new Set(snapshot.projects.map(p=>p.id)),refs=new Map();let nodes=0,unverifiedLinkCount=0;
 function walk(value,projectId,depth){
  if(++nodes>100000||depth>64)throw Error('백업 참조 목록 제한');
  if(!value||typeof value!=='object')return;
  if(Object.hasOwn(value,'providerFileId')){
   const ref=Object.fromEntries(bindingKeys.map(k=>[k,k==='projectId'?value[k]??projectId:value[k]]));
   if(projectId&&ref.projectId!==projectId)throw Error('백업 원본 프로젝트 연결 오류');
   if(!bindingKeys.slice(0,4).every(k=>key(ref[k]))||!projects.has(ref.projectId)||! /^[a-f0-9]{64}$/.test(ref.sha256??'')||!Number.isSafeInteger(ref.sizeBytes)||ref.sizeBytes<=0||ref.sizeBytes>100*1024*1024)throw Error('백업 원본의 고정 버전 참조 오류');
   const prior=refs.get(ref.providerFileId);if(prior&&JSON.stringify(prior)!==JSON.stringify(ref))throw Error('백업 원본 ID·버전 충돌');refs.set(ref.providerFileId,ref);if(refs.size>1000)throw Error('백업 원본 파일 수 제한');
  }else if(typeof value.url==='string'&&/^https?:/i.test(value.url))unverifiedLinkCount++;
  for(const child of Object.values(value))walk(child,projectId,depth+1);
 }
 for(const project of snapshot.projects)walk(project,project.id,0);
 for(const visit of snapshot.visits??[])walk(visit,visit?.projectId,0);
 for(const audit of snapshot.importJobs??[])walk(audit,audit?.projectId,0);
 // Unknown shared collections are preserved too; their file refs require explicit project bindings.
 walk(snapshot.additionalMetadata,undefined,0);
 const files={'metadata.json':metadata},inventory=[];let total=metadata.length;
 for(const ref of [...refs.values()].sort((a,b)=>a.providerFileId.localeCompare(b.providerFileId))){
  await check();const original=await download(ref,{maxBytes:100*1024*1024-total});await check();
  if(!(original?.bytes instanceof Uint8Array)||bindingKeys.some(k=>original.reference?.[k]!==ref[k])||original.bytes.byteLength!==ref.sizeBytes||hash(original.bytes)!==ref.sha256)throw Error('백업 원본 바이트·연결 검증 실패');
  total+=original.bytes.byteLength;if(total>100*1024*1024)throw Error('백업 원본 용량 제한');
  const path='originals/'+ref.providerFileId+'.bin';files[path]=Buffer.from(original.bytes);inventory.push({...ref,path});
 }
 const manifest={kind:'BRING_RND_ENUMERATED_ORIGINAL_PACKAGE',version:1,generatedAt:new Date().toISOString(),scope:'authoritative-snapshot-and-enumerated-fixed-originals',metadataSHA256:hash(metadata),files:inventory,unverifiedLinkCount,allEnumeratedOriginalsIncluded:true,fullBackup:false,restoreReady:false,cloudWrites:false};
 files['manifest.json']=Buffer.from(JSON.stringify(manifest,null,2));await check();return{bytes:zipBinaryFiles(files),manifest};
}
module.exports={buildOriginalBackup};
