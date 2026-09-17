/** Read-only Main service. Journal is Main-owned; renderer cannot choose actor/path or receive original data. */
function createOriginalRestoreHistory({access,captureSession,isCurrent,journal}){
 return async input=>{
  if(input!==undefined)throw Error('복원 기록 조회에는 입력을 전달하지 마세요');const binding=captureSession(),actor=structuredClone(await access());
  const check=async()=>{if(!isCurrent(binding))throw Error('복원 기록 로그인 세션이 변경되었습니다');const current=await access();if(!isCurrent(binding))throw Error('복원 기록 로그인 세션이 변경되었습니다');if(actor?.role!=='admin'||actor.mustChangePassword||!actor.uid||!actor.email||current?.role!=='admin'||current.mustChangePassword||current.uid!==actor.uid||current.email!==actor.email)throw Error('복원 기록 관리자 권한이 필요합니다');};
  await check();const records=structuredClone(await journal.list(actor.uid));await check();if(!Array.isArray(records)||records.length>100)throw Error('복원 기록 조회 한도 오류');
  return records.map(record=>{if(record.actorUid!==undefined&&record.actorUid!==actor.uid)throw Error('복원 기록 계정 연결 오류');const events=record.events??[],known=Array.isArray(record.files),fileCount=known?record.files.length:null,verifiedFileCount=events.filter(e=>e.type==='UPLOAD_VERIFIED').length,uncertainFileCount=events.filter(e=>e.type==='UPLOAD_UNCERTAIN').length,pendingFileCount=known?fileCount-verifiedFileCount-uncertainFileCount:null;if(known&&(fileCount>1000||pendingFileCount<0))throw Error('복원 기록 파일 수 오류');
   const status=record.incomplete||uncertainFileCount?'REQUIRES_REVIEW':pendingFileCount===0?'UPLOADED_VERIFIED':events.length?'INCOMPLETE':'NOT_STARTED';
   return{attemptId:record.attemptId??null,previewId:record.previewId??null,mappingSHA256:record.mappingSHA256??null,sourceZipSHA256:record.sourceZipSHA256??null,fileCount,verifiedFileCount,uncertainFileCount,pendingFileCount,status,storageIncomplete:record.incomplete===true,restoreReady:false,databaseWrites:false};
  });
 };
}
module.exports={createOriginalRestoreHistory};
