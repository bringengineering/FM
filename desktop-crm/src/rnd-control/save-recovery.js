const {createHash}=require('node:crypto');
const {researchFingerprint}=require('./repository');
function createSaveRecovery({access,ledger,get}){
 return{async check(input){
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(input?.operationId??''))throw Error('저장 작업 ID 오류');
  const actor={...await access()};
  const same=async()=>{const current=await access();if(current.uid!==actor.uid||current.role!==actor.role||current.email!==actor.email)throw Error('로그인 세션이 변경되었습니다');};
  const records=await ledger.list(actor.uid);await same();
  const attempt=records.find(x=>x.operationId===input.operationId);
  if(!attempt)throw Error('현재 계정의 저장 작업 기록이 아닙니다');
  let observed;
  try{observed=await get(attempt.collection,attempt.recordId);}catch(error){await same();return{operationId:attempt.operationId,status:'READ_FAILED',message:'현재 공유 기록 조회 실패 · 저장 여부를 확정할 수 없습니다'};}
  await same();
  const matched=observed?.operationId===attempt.operationId&&observed.revision===attempt.revision&&createHash('sha256').update(researchFingerprint(observed)).digest('hex')===attempt.contentSHA256;
  return{operationId:attempt.operationId,status:matched?'CURRENT_MATCH':'CURRENT_DIFFERENT',message:matched?'현재 공유 기록과 작업 ID·버전·내용 일치':'현재 공유 기록 불일치 · 이후 변경 또는 미저장 여부를 확정할 수 없습니다'};
 }};
}
module.exports={createSaveRecovery};
