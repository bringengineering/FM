const {verifyOriginalBackup}=require('./original-backup-verification');
async function readOriginalBackupFile(path,{open,check}){
 await check();const handle=await open(path,'r');try{
  await check();const stat=await handle.stat();if(!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size<1||stat.size>104*1024*1024)throw Error('보관 ZIP 파일 용량·형식 제한');
  const chunks=[];let total=0;
  for(;;){await check();const buffer=Buffer.alloc(256*1024),{bytesRead}=await handle.read(buffer,0,buffer.length,total);await check();if(!bytesRead)break;total+=bytesRead;if(total>stat.size||total>104*1024*1024)throw Error('읽는 동안 보관 ZIP 파일 크기가 변경되었습니다');chunks.push(buffer.subarray(0,bytesRead));}
  if(total!==stat.size)throw Error('보관 ZIP 파일 읽기 미완료');await check();return Buffer.concat(chunks,total);
 }finally{await handle.close();}
}
function createOriginalBackupInspection({access,captureSession,isCurrent,chooseFile,read,validate,verify=verifyOriginalBackup}){
 return async input=>{
  if(input!==undefined)throw Error('보관본 검증은 Main 파일 선택만 허용합니다');const binding=captureSession();if(!isCurrent(binding))throw Error('로그인 세션이 변경되었습니다');const actor=structuredClone(await access());
  const check=async()=>{if(!isCurrent(binding))throw Error('로그인 세션이 변경되었습니다');const current=await access();if(!isCurrent(binding))throw Error('로그인 세션이 변경되었습니다');if(!actor?.uid||!actor.email||actor.role!=='admin'||current?.role!=='admin'||current.mustChangePassword||current.uid!==actor.uid||current.email!==actor.email)throw Error('전체 보관본 검증은 승인된 관리자 권한이 필요합니다');};
  await check();const chosen=await chooseFile();await check();if(chosen.canceled)return{canceled:true};if(!Array.isArray(chosen.filePaths)||chosen.filePaths.length!==1||typeof chosen.filePaths[0]!=='string'||!chosen.filePaths[0])throw Error('보관본 파일을 선택하세요');
  const bytes=await read(chosen.filePaths[0],check);await check();const result=await verify(bytes,{check});await check();await validate(result.metadata);await check();
  return{verified:true,projectCount:result.metadata.projects.length,visitCount:result.metadata.visits.length,importJobCount:result.metadata.importJobs.length,fileCount:result.fileCount,unverifiedLinkCount:result.manifest.unverifiedLinkCount,originVerified:false,fullBackup:false,restoreReady:false,cloudWrites:false};
 };
}
module.exports={createOriginalBackupInspection,readOriginalBackupFile};
