const {createHash}=require('node:crypto'),{readBoundedJSON}=require('./bounded-json');
/** Fixed trusted database configuration only; no renderer endpoint, no writes or credential return. */
function createOriginalBackupSnapshotReader({access,captureSession,isCurrent,token,databaseUrl,fetch:request}){
 const base=new URL(databaseUrl);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||!['','/'].includes(base.pathname))throw Error('백업용 신뢰된 데이터베이스 설정 오류');
 return async()=>{
  const binding=captureSession(),actor=structuredClone(await access());let credential='',response;
  const session=()=>{if(!isCurrent(binding))throw Error('백업 조회 로그인 세션이 변경되었습니다');};
  const check=async()=>{session();const current=await access();session();if(!actor?.uid||!actor.email||current?.role!=='admin'||current.mustChangePassword||current.uid!==actor.uid||current.email!==actor.email||current.role!==actor.role)throw Error('백업 전체 자료 조회는 현재 관리자 권한이 필요합니다');};
  try{
   await check();credential=await token();await check();if(typeof credential!=='string'||!credential||credential.length>16384)throw Error('백업 인증 정보 오류');
   response=await request(base.origin+'/rndControl.json?auth='+encodeURIComponent(credential),{method:'GET',headers:{'X-Firebase-ETag':'true'},redirect:'error',signal:AbortSignal.timeout(20000)});await check();
   if(!response.ok)throw Error('백업 공유 자료 조회 실패');
   let value;try{value=structuredClone(await readBoundedJSON(response,20*1024*1024,session));}catch{session();throw Error('백업 자료의 응답·용량·JSON 형식을 확인하세요');}
   await check();const etag=response.headers?.get('etag');if(typeof etag!=='string'||!etag||!value||typeof value!=='object'||Array.isArray(value))throw Error('백업 공유 자료·원격 버전 확인 실패');
   return{value,etag,actorUid:actor.uid,contentSHA256:createHash('sha256').update(JSON.stringify(value)).digest('hex')};
  }finally{credential='';try{await response?.body?.cancel?.();}catch{}}
 };
}
module.exports={createOriginalBackupSnapshotReader};
