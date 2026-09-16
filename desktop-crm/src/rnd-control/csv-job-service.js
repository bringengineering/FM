const Core=require('../core'),{csvJobDigest}=require('./csv-job-ledger');
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error('CSV 가져오기 기록 요청 항목 오류');}
function createCSVJobService({access,captureSession,isCurrent,preview,ledger}){
 async function session(){const binding=captureSession(),actor={...await access()};Core.assertMutationAllowed(actor);if(!actor.email||!isCurrent(binding))throw Error('로그인 세션이 변경되었습니다');const check=async()=>{if(!isCurrent(binding))throw Error('로그인 세션이 변경되었습니다');const current=await access();Core.assertMutationAllowed(current);if(!isCurrent(binding)||current.uid!==actor.uid||current.email!==actor.email||current.role!==actor.role)throw Error('로그인 세션이 변경되었습니다');};return{actor,check};}
 return{
 create:async input=>{exact(input,['input','reviewedPreview','skipIds']);const bytes=input.input?.bytes;if(!(bytes instanceof Uint8Array)&&!(bytes instanceof ArrayBuffer)||!bytes.byteLength||bytes.byteLength>8*1024*1024)throw Error('CSV 원본 바이트·용량 오류');if(Buffer.byteLength(JSON.stringify(input.reviewedPreview)??'')>16*1024*1024)throw Error('CSV 검토 결과 용량 한도');const owned=structuredClone({...input,input:{...input.input,bytes:undefined}});owned.input.bytes=bytes instanceof ArrayBuffer?new Uint8Array(bytes.slice(0)):new Uint8Array(bytes);const {actor,check}=await session();const latest=await preview(owned.input);await check();if(latest.actorUid!==actor.uid||csvJobDigest(latest)!==csvJobDigest(owned.reviewedPreview))throw Error('공유 자료가 변경됐습니다. 다시 검토하세요');const job=await ledger.create(actor.uid,{bytes:owned.input.bytes,preview:latest,skipIds:owned.skipIds,actorEmail:actor.email});await check();return job;},
 list:async()=>{const {actor,check}=await session();await check();const records=await ledger.list(actor.uid);await check();return records;},
 get:async input=>{exact(input,['jobId']);const jobId=input.jobId,{actor,check}=await session();await check();const record=await ledger.get(actor.uid,jobId);await check();return record;},
 receipt:async input=>{exact(input,['jobId','kind','ids']);const owned=structuredClone(input),{actor,check}=await session();await check();const entry=await ledger.receipt(actor.uid,owned.jobId,{kind:owned.kind,ids:owned.ids});await check();return entry;}
 };
}
module.exports={createCSVJobService};
