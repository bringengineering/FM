const {createOriginalRestoreReferenceVerifier}=require('./original-restore-reference-verification');
/** Main-only, read-only recovery bridge. Renderer supplies IDs; authority, ZIP, journal and Drive stay private. */
function createOriginalRestoreReferenceExecution({access,captureSession,isCurrent,sessions,journal,drive}){
 return async input=>{
  const request=structuredClone(input);if(!request||Object.keys(request).sort().join(',')!=='attemptId,previewId,targets'||typeof request.previewId!=='string'||! /^[a-f0-9]{64}$/.test(request.attemptId))throw Error('원본 재검증 요청 오류');
  const binding=captureSession(),actor=structuredClone(await access()),mappingRequest={previewId:request.previewId,targets:request.targets};
  const check=async()=>{if(!isCurrent(binding))throw Error('원본 재검증 로그인 세션이 변경되었습니다');const current=await access();if(!isCurrent(binding))throw Error('원본 재검증 로그인 세션이 변경되었습니다');if(actor?.role!=='admin'||actor.mustChangePassword||!actor.uid||!actor.email||current?.role!=='admin'||current.mustChangePassword||current.uid!==actor.uid||current.email!==actor.email)throw Error('원본 재검증 관리자 권한이 필요합니다');await sessions.mapping(mappingRequest);if(!isCurrent(binding))throw Error('원본 재검증 로그인 세션이 변경되었습니다');if(drive.state().status!=='READY')throw Error('회사 Drive 연결·보관권한 확인이 필요합니다');};
  await check();return createOriginalRestoreReferenceVerifier({actorUid:actor.uid,check,prepare:()=>sessions.prepare(mappingRequest),journal,verifyVersion:ref=>drive.verifyVersion(ref)})(request);
 };
}
module.exports={createOriginalRestoreReferenceExecution};
