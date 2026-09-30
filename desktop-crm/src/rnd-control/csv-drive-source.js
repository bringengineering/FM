const Core=require('../core'),{createHash}=require('node:crypto');
const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
function createCSVDriveSource({access,captureSession,isCurrent,ledger,getProject,upload}){
 return async input=>{
  if(!input||Array.isArray(input)||Object.keys(input).length!==1||!validId(input.jobId))throw Error('CSV 원본 보관 요청 오류');
  const jobId=input.jobId,binding=captureSession(),actor={...await access()};Core.assertMutationAllowed(actor);
  const check=async()=>{if(!isCurrent(binding))throw Error('로그인 세션이 변경되었습니다');const current=await access();Core.assertMutationAllowed(current);if(!isCurrent(binding)||!actor.email||current.uid!==actor.uid||current.email!==actor.email||current.role!==actor.role)throw Error('로그인 세션이 변경되었습니다');};
  await check();const job=await ledger.get(actor.uid,jobId);await check();
  if(job.id!==jobId||job.actorUid!==actor.uid)throw Error('CSV 원본 계정 연결 오류');
  const project=await getProject(job.source.projectId);await check();if(!project||project.id!==job.source.projectId||!Number.isSafeInteger(project.revision))throw Error('대상 프로젝트를 먼저 공유 저장하세요');
  const bytes=Buffer.from(await ledger.original(actor.uid,jobId));await check();if(bytes.length!==job.source.sizeBytes||createHash('sha256').update(bytes).digest('hex')!==job.source.sha256)throw Error('CSV 원본 검증 실패');
  const artifactId='csv-import-original',versionId=job.id,context={projectId:project.id,artifactId,versionId};
  async function preserve(record){await ledger.driveReceipt(actor.uid,jobId,{...record,...context});}
  let result;
  try{result=await upload({...context,fileName:job.source.fileName,mimeType:'text/csv',bytes});}
  catch(error){if(error.recoveryRecord){try{await preserve(error.recoveryRecord);}catch{throw Error('Drive 검증 미완료 · 복구 기록 보관 실패');}}await check();throw error;}
  if(!validId(result?.providerFileId)||result.versionId!==versionId||result.artifactId!==artifactId||result.sha256!==job.source.sha256||result.sizeBytes!==bytes.length||typeof result.verifiedAt!=='string'||!Number.isFinite(Date.parse(result.verifiedAt)))throw Error('CSV Drive 보관본 검증 실패');
  try{await preserve(result);}catch{await check();throw Error('Drive 원본 검증 완료 · 복구 기록 보관 실패 · 자동 재시도하지 않습니다');}
  await check();const latest=await getProject(project.id);await check();if(!latest||latest.id!==project.id||latest.revision!==project.revision)throw Error('Drive 보관 완료 · 프로젝트 변경으로 연결 미확인 · 복구 기록을 조회하세요');
  return{...context,jobId,providerFileId:result.providerFileId,sha256:result.sha256,sizeBytes:result.sizeBytes,verifiedAt:result.verifiedAt,url:'https://drive.google.com/file/d/'+result.providerFileId+'/view',scope:'csv-original-drive-copy',databaseWrites:false};
 };
}
module.exports={createCSVDriveSource};
