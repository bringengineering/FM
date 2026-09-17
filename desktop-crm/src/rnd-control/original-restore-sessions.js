const {createHash}=require('node:crypto'),{createOriginalRestoreMapping}=require('./original-restore-mapping');const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Main-owned, short-lived plans. add is trusted-only; renderer supplies review ID and targets. */
function createOriginalRestoreSessions({access,isCurrent,readSnapshot,now=()=>Date.now(),map=createOriginalRestoreMapping}){
 const records=new Map();
 function add({preview,actor,binding,currentIds}){if(typeof preview?.previewId!=='string'||!preview.previewId||JSON.stringify(preview).length>4*1024*1024)throw Error('복원 검토 세션 형식·용량 오류');for(const [id,entry]of records)if(now()-entry.createdAt>600000||!isCurrent(entry.binding))records.delete(id);if(records.size>=3)records.delete(records.keys().next().value);records.set(preview.previewId,{preview:structuredClone(preview),actor:structuredClone(actor),binding,currentIds:structuredClone(currentIds),createdAt:now()});}
 async function mapping(input){const request=structuredClone(input);if(!request||Array.isArray(request)||Object.keys(request).sort().join(',')!=='previewId,targets'||typeof request.previewId!=='string')throw Error('복원 매핑 요청 오류');const entry=records.get(request.previewId);if(!entry)throw Error('복원 검토가 없거나 만료되었습니다 · 다시 검토하세요');
  const check=async()=>{if(records.get(request.previewId)!==entry)throw Error('복원 검토가 만료되었습니다');if(!isCurrent(entry.binding))throw Error('복원 검토 로그인 세션이 변경되었습니다');if(now()-entry.createdAt>600000||now()<entry.createdAt)throw Error('복원 검토가 만료되었습니다');const actor=await access();if(records.get(request.previewId)!==entry)throw Error('복원 검토가 만료되었습니다');if(now()-entry.createdAt>600000||now()<entry.createdAt)throw Error('복원 검토가 만료되었습니다');if(!isCurrent(entry.binding))throw Error('복원 검토 로그인 세션이 변경되었습니다');if(actor?.role!=='admin'||actor.mustChangePassword||!entry.actor.uid||!entry.actor.email||entry.actor.role!=='admin'||actor.uid!==entry.actor.uid||actor.email!==entry.actor.email)throw Error('복원 검토 관리자 권한이 변경되었습니다');};
  const unchanged=async()=>{const latest=await readSnapshot();await check();if(latest?.etag!==entry.preview.sharedETag||(latest.emptyRoot===true)!==entry.preview.sharedEmptyRoot||digest(latest.value)!==entry.preview.sharedRootSHA256)throw Error('검토 이후 공유 자료가 변경되었습니다 · 다시 검토하세요');};
  const validateCurrent=async()=>{try{await check();await unchanged();}catch(error){if(records.get(request.previewId)===entry)records.delete(request.previewId);throw error;}};
  await validateCurrent();const result=map(entry.preview,entry.currentIds,request.targets);await validateCurrent();return result;
 }
 return{add,mapping,clear:()=>records.clear()};
}
module.exports={createOriginalRestoreSessions};
