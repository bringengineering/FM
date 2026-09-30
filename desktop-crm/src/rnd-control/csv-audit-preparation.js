const Core=require('../core'),{buildCSVImportAudit}=require('./csv-import-audit');
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
function createCSVAuditPreparation({access,captureSession,isCurrent,ledger,getProject,verifySource,now=()=>new Date(),buildAudit=buildCSVImportAudit}){
 return async input=>{
  if(!input||Array.isArray(input)||Object.keys(input).length!==2||Object.keys(input).some(key=>!['jobId','providerFileId'].includes(key))||!validId(input.jobId)||!validId(input.providerFileId))throw Error('CSV 공유 감사 검토 요청 오류');
  const {jobId,providerFileId}=input,binding=captureSession(),actor={...await access()};Core.assertMutationAllowed(actor);
  const check=async()=>{if(!isCurrent(binding))throw Error('로그인 세션이 변경되었습니다');const current=await access();Core.assertMutationAllowed(current);if(!isCurrent(binding)||!actor.email||current.uid!==actor.uid||current.role!==actor.role||current.email!==actor.email)throw Error('로그인 세션이 변경되었습니다');};
  await check();const job=await ledger.get(actor.uid,jobId);await check();if(job.id!==jobId||job.actorUid!==actor.uid)throw Error('CSV 원본 계정 연결 오류');
  const project=await getProject(job.source.projectId);await check();if(!project||project.id!==job.source.projectId||!Number.isSafeInteger(project.revision)||project.revision<1)throw Error('대상 프로젝트를 먼저 공유 저장하세요');
  const driveReference=await verifySource({jobId,providerFileId});await check();if(driveReference?.jobId!==jobId||driveReference.providerFileId!==providerFileId)throw Error('CSV 감사 Drive 연결 오류');
  const at=now().toISOString(),audit=await buildAudit({job,driveReference,projectRevision:project.revision,publisher:actor,at});await check();
  const latest=await getProject(project.id);await check();if(!latest||latest.id!==project.id||latest.revision!==project.revision)throw Error('프로젝트가 변경되었습니다. 공유 감사 명세를 다시 검토하세요');
  const dryRun=JSON.parse(audit.dryRunJSON);
  return{scope:'csv-shared-audit-preview',canPublish:false,databaseWrites:false,jobId,projectId:project.id,projectRevision:project.revision,preparedAt:at,auditSHA256:audit.integritySHA256,source:Object.fromEntries(['fileName','ledger','extractedAt','sha256','sizeBytes','mapping'].map(key=>[key,job.source[key]])),driveReference:audit.driveReference,totals:{additions:dryRun.additions.length,conflicts:dryRun.conflicts.length,skipped:dryRun.skippedIds.length},additions:dryRun.additions.slice(0,50),conflicts:dryRun.conflicts.slice(0,50),skippedIds:dryRun.skippedIds.slice(0,50)};
 };
}
module.exports={createCSVAuditPreparation};
