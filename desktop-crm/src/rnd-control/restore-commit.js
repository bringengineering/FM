const {randomUUID}=require('node:crypto');const {createRestoreMutation}=require('./restore-mutation');const {researchFingerprint}=require('./repository');
function administrator(user){if(!user?.uid||!user.email||user.role!=='admin'||user.mustChangePassword)throw Error('공유 복원 저장은 승인된 관리자만 가능합니다');return {...user};}
function createAtomicRestoreCommit({access,token,databaseUrl,fetch:request=globalThis.fetch,compile=createRestoreMutation}){return async input=>{
 const captured=structuredClone(input);const actor=administrator(await access());const unchanged=async()=>{const now=administrator(await access());if(now.uid!==actor.uid||now.email!==actor.email||now.role!==actor.role)throw Error('로그인 세션이 변경되었습니다');};
 const mutation=compile({...captured,operationId:randomUUID(),at:new Date().toISOString()});if(mutation.audit?.actorUid!==actor.uid||typeof mutation.expectedETag!=='string'||!mutation.expectedETag)throw Error('복원 승인 계정/버전 불일치');
 const expected=researchFingerprint(mutation.value);const result=recovered=>({operationId:mutation.operationId,recovered,audit:structuredClone(mutation.audit)});
 const endpoint=async()=>{const authToken=await token();await unchanged();return `${databaseUrl}/rndControl.json?auth=${encodeURIComponent(authToken)}`;};
 const writeEndpoint=await endpoint();let response;
 try{response=await request(writeEndpoint,{method:'PUT',headers:{'Content-Type':'application/json','if-match':mutation.expectedETag},body:JSON.stringify(mutation.value),signal:AbortSignal.timeout(20000)});if(response.ok){const observed=await response.json();await unchanged();if(researchFingerprint(observed)!==expected)throw Error('복원 저장 응답 내용 불일치');return result(false);}}
 catch(error){await unchanged();try{const recoveryEndpoint=await endpoint();const recovery=await request(recoveryEndpoint,{method:'GET',signal:AbortSignal.timeout(20000)});if(recovery.ok){const observed=await recovery.json();await unchanged();if(observed?.restoreApprovals?.[mutation.operationId]?.id===mutation.operationId&&researchFingerprint(observed)===expected)return result(true);}}catch(recoveryError){await unchanged();}throw Error(`복원 저장 결과 확인 불가 · 작업 ${mutation.operationId} · 최신 자료를 조회하세요. 자동 재저장하지 않습니다`);}
 await unchanged();if(response.status===412)throw Error('동시편집 충돌: 복원을 적용하지 않았습니다. 다시 검사하세요');if(!response.ok)throw Error(`공유 복원 저장 실패 (${response.status})`);
 };}
module.exports={createAtomicRestoreCommit};
