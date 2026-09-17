const {createHash}=require('node:crypto'),{buildOriginalBackup}=require('./original-backup');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Trusted Main dependencies only. Renderer may supply a selected project ID, never snapshot, bytes or path. */
function createOriginalBackupExport({access,captureSession,isCurrent,readSnapshot,prepareSnapshot,download,chooseFile,save,build=buildOriginalBackup}){
 return async input=>{
  const owned=structuredClone(input);if(!owned||Array.isArray(owned)||Object.keys(owned).length!==1||typeof owned.projectId!=='string'||! /^[a-zA-Z0-9_-]{1,128}$/.test(owned.projectId??''))throw Error('원본 보관 요청 오류');
  const binding=captureSession(),actor=structuredClone(await access());
  const check=async()=>{if(!isCurrent(binding))throw Error('로그인 세션이 변경되었습니다');const current=await access();if(!isCurrent(binding))throw Error('로그인 세션이 변경되었습니다');if(!actor?.uid||!actor.email||current?.role!=='admin'||current.mustChangePassword||current.uid!==actor.uid||current.email!==actor.email||current.role!==actor.role)throw Error('공유 전체 원본 보관은 현재 승인된 관리자 권한이 필요합니다');};
  await check();const source=structuredClone(await readSnapshot());await check();
  if(typeof source?.etag!=='string'||!source.etag||!source.value?.projects?.[owned.projectId])throw Error('현재 공유 프로젝트·자료 버전을 확인하세요');
  const expected=digest(source.value),snapshot=structuredClone(await prepareSnapshot(source.value,owned.projectId));await check();
  const result=await build(snapshot,{check,download});await check();
  const unchanged=async()=>{const latest=structuredClone(await readSnapshot());await check();if(latest?.etag!==source.etag||digest(latest.value)!==expected)throw Error('보관 중 공유 자료가 변경되었습니다 · 다시 조회하세요');};
  await unchanged();const selected=await chooseFile();await check();if(selected.canceled)return{canceled:true};if(typeof selected.filePath!=='string'||!selected.filePath)throw Error('원본 보관 경로를 선택하세요');
  await unchanged();await save(selected.filePath,result.bytes,check);await check();
  return{saved:true,path:selected.filePath,fileCount:result.manifest.files.length,fullBackup:false,restoreReady:false,cloudWrites:false};
 };
}
module.exports={createOriginalBackupExport};
