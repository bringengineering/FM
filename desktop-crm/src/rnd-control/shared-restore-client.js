const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function administrator(actor){if(!actor?.uid||!actor.email||actor.role!=='admin'||actor.mustChangePassword)throw Error('공유 복원은 승인된 관리자만 가능합니다');return{...actor};}
/** Trusted Main dependencies only. Endpoint and credentials never come from renderer input. */
function createSharedRestoreClient({enabled,access,captureSession,isCurrent,token,baseUrl,fetch:request=globalThis.fetch,now=Date.now}){
 const endpoint=new URL(baseUrl);if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!((endpoint.protocol==='https:'&&/^[a-z0-9-]+\.cloudfunctions\.net$/.test(endpoint.hostname))||(endpoint.protocol==='http:'&&endpoint.hostname==='127.0.0.1')))throw Error('공유 복원 서버 주소 오류');
 const sessions=new Map(),busy=new Set();let preparing=false;
 const flag=()=>{if(!enabled())throw Error('공유 복원 실행 기능이 활성화되지 않았습니다');};
 async function guard(binding){flag();if(!isCurrent(binding.session))throw Error('로그인 세션이 변경되었습니다');const current=administrator(await access());if(!isCurrent(binding.session)||current.uid!==binding.actor.uid||current.email!==binding.actor.email||current.role!==binding.actor.role)throw Error('로그인 세션이 변경되었습니다');}
 async function call(name,data,binding){await guard(binding);const credential=await token();await guard(binding);if(typeof credential!=='string'||!credential)throw Error('CRM 로그인 인증이 필요합니다');let response;
  try{response=await request(baseUrl.replace(/\/$/,'')+'/'+name,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential},body:JSON.stringify({data}),signal:AbortSignal.timeout(120000),redirect:'error'});}catch(error){await guard(binding);throw Error('공유 복원 서버 응답 확인 불가 · 같은 승인 요청의 상태를 다시 확인하세요. 자동 재실행하지 않습니다');}
  await guard(binding);let payload;try{payload=await response.json();}catch(error){await guard(binding);throw Error('공유 복원 응답 형식 오류 · 자동 재실행하지 않습니다');}await guard(binding);
  if(!response.ok||payload.error){const messages={UNAUTHENTICATED:'로그인을 다시 확인하세요',PERMISSION_DENIED:'현재 CRM·R&D 관리자 승인이 필요합니다',FAILED_PRECONDITION:'서버 공유 복원 기능이 활성화되지 않았습니다',INVALID_ARGUMENT:'백업·검토 결과·승인 사유를 확인하세요',ABORTED:'승인 만료 또는 공유 자료 변경 · 다시 검사하세요'};throw Error(messages[payload.error?.status]??'공유 복원 서버 처리 실패 · 자동 재실행하지 않습니다');}
  if(!payload.result||typeof payload.result!=='object'||Array.isArray(payload.result))throw Error('공유 복원 응답 형식 오류');return payload.result;
 }
 return{
  clear(){sessions.clear();},
  async prepare(input){flag();if(preparing)throw Error('공유 복원 승인 준비가 진행 중입니다');preparing=true;try{const source=structuredClone(input);const session=captureSession(),actor=administrator(await access()),binding={session,actor};await guard(binding);if(!source||typeof source!=='object'||typeof source.reason!=='string'||!source.reason.trim()||source.reason.length>4000||Buffer.byteLength(JSON.stringify(source),'utf8')>16*1024*1024)throw Error('복원 백업·검토·승인 사유 형식/크기 오류');
   for(const [id,value]of sessions)if(value.expiresAt<=now()||!isCurrent(value.session))sessions.delete(id);if(sessions.size>=20)throw Error('승인 요청이 많습니다. 만료 후 다시 검사하세요');
   const result=await call('rndPrepareSharedRestore',{backup:source.backup,reviewed:source.reviewed,reason:source.reason},binding);if(!uuid(result.sessionId)||!Number.isSafeInteger(result.expiresAt)||result.expiresAt<=now()||result.expiresAt>now()+600000||result.scope!=='metadata-only'||!result.projects||!result.visits)throw Error('공유 복원 승인 응답 오류');sessions.set(result.sessionId,{...binding,expiresAt:result.expiresAt});return structuredClone(result);
  }finally{preparing=false;}},
  async commit(input){flag();const id=input?.sessionId;if(!uuid(id)||!sessions.has(id))throw Error('이 로그인에서 준비한 복원 승인 요청이 필요합니다');const binding=sessions.get(id);await guard(binding);if(binding.expiresAt<=now())throw Error('복원 승인이 만료되었습니다. 다시 검사하세요');if(busy.has(id))throw Error('이 승인 요청의 복원이 진행 중입니다');busy.add(id);try{const result=await call('rndCommitSharedRestore',{sessionId:id},binding);if(result.operationId!==id||result.status!=='COMMITTED'||result.audit?.id!==id||result.audit.actorUid!==binding.actor.uid)throw Error('공유 복원 완료 응답 불일치 · 최신 자료를 조회하세요');return structuredClone(result);}finally{busy.delete(id);}}
 };
}
module.exports={createSharedRestoreClient};
