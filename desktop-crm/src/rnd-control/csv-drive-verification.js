const Core=require('../core'),{normalizeCSVDriveRef}=require('./csv-drive-ref');
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
function createCSVDriveVerification({access,captureSession,isCurrent,ledger,getProject,verifyVersion}){
 return async input=>{
  if(!input||Array.isArray(input)||Object.keys(input).length!==2||Object.keys(input).some(key=>!['jobId','providerFileId'].includes(key))||!validId(input.jobId)||!validId(input.providerFileId))throw Error('CSV 원본 재검증 요청 오류');
  const {jobId,providerFileId}=input,binding=captureSession(),actor={...await access()};Core.assertMutationAllowed(actor);
  const check=async()=>{if(!isCurrent(binding))throw Error('로그인 세션이 변경되었습니다');const current=await access();Core.assertMutationAllowed(current);if(!isCurrent(binding)||!actor.email||current.uid!==actor.uid||current.email!==actor.email||current.role!==actor.role)throw Error('로그인 세션이 변경되었습니다');};
  await check();const job=await ledger.get(actor.uid,jobId);await check();if(job.actorUid!==actor.uid||job.id!==jobId)throw Error('CSV 원본 계정 연결 오류');
  const events=await ledger.receipts(actor.uid,jobId);await check();const known=events.find(e=>e.kind==='CSV_DRIVE_ORIGINAL'&&e.reference?.providerFileId===providerFileId);if(!known)throw Error('현재 계정 CSV 이력에 보관된 Drive 원본만 검증합니다');
  const reference=normalizeCSVDriveRef(known.reference,job),project=await getProject(job.source.projectId);await check();if(!project||project.id!==job.source.projectId||!Number.isSafeInteger(project.revision))throw Error('대상 프로젝트를 먼저 공유 저장하세요');
  const result=await verifyVersion({providerFileId:reference.providerFileId,versionId:reference.versionId,artifactId:reference.artifactId,sha256:reference.sha256,projectId:reference.projectId});
  if(result?.providerFileId!==providerFileId||result.versionId!==reference.versionId||result.artifactId!==reference.artifactId)throw Error('CSV Drive 원본 재검증 연결 불일치');
  const verified=normalizeCSVDriveRef({...result,projectId:reference.projectId,status:'VERIFIED'},job);
  try{await ledger.driveReceipt(actor.uid,jobId,verified);}catch{await check();throw Error('Drive 재검증 완료 · 확인 이력 보관 실패 · 자동 재시도하지 않습니다');}
  await check();const latest=await getProject(project.id);await check();if(!latest||latest.id!==project.id||latest.revision!==project.revision)throw Error('Drive 재검증 완료 · 프로젝트 변경으로 응답 연결 미확인 · CSV 이력을 조회하세요');
  return{...verified,jobId,url:'https://drive.google.com/file/d/'+providerFileId+'/view',scope:'csv-original-drive-reverification',databaseWrites:false};
 };
}
module.exports={createCSVDriveVerification};
