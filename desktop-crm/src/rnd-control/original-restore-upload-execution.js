const {createOriginalRestoreUploader}=require('./original-restore-uploader');
/** Main-only bridge. IDs from renderer; source, authorization dialog, journal and Drive remain trusted adapters. */
function createOriginalRestoreUploadExecution({enabled=false,access,captureSession,isCurrent,sessions,journal,drive,confirm}){
 return async input=>{
  if(!enabled)throw Error('원본 재업로드 실행 기능이 활성화되지 않았습니다');const request=structuredClone(input);if(!request||Object.keys(request).sort().join(',')!=='previewId,targets'||typeof request.previewId!=='string')throw Error('원본 재업로드 요청 오류');
  const binding=captureSession(),actor=structuredClone(await access());
  const check=async()=>{if(!isCurrent(binding))throw Error('원본 재업로드 로그인 세션이 변경되었습니다');const current=await access();if(!isCurrent(binding))throw Error('원본 재업로드 로그인 세션이 변경되었습니다');if(actor?.role!=='admin'||actor.mustChangePassword||!actor.uid||!actor.email||current?.role!=='admin'||current.mustChangePassword||current.uid!==actor.uid||current.email!==actor.email)throw Error('원본 재업로드 관리자 권한이 필요합니다');await sessions.mapping(request);if(!isCurrent(binding))throw Error('원본 재업로드 로그인 세션이 변경되었습니다');};
  await check();if(drive.state().status!=='READY')throw Error('회사 Drive 연결·보관권한 확인이 필요합니다');
  return createOriginalRestoreUploader({enabled:true,check,prepare:()=>sessions.prepare(request),journal,upload:file=>drive.upload(file),authorize:async sourceBinding=>{await check();const approved=await confirm(structuredClone(sourceBinding));await check();if(approved!==true)throw Error('원본 업로드 승인을 취소했습니다');return{...sourceBinding,approved:true,actorUid:actor.uid};}})(request);
 };
}
module.exports={createOriginalRestoreUploadExecution};
