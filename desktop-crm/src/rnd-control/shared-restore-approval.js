const {createHash}=require('node:crypto');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function binding(report){return {kind:report?.kind,version:report?.version,scope:report?.scope,actorUid:report?.actorUid,backupArchiveSHA256:report?.backupArchiveSHA256,projects:report?.projects,visits:report?.visits};}
async function prepareSharedRestoreApproval({backup,reviewed,preview,reason}){
 if(typeof reason!=='string'||!reason.trim()||reason.length>4000)throw Error('복원 승인 사유가 필요합니다');
 const source=structuredClone(backup),review=structuredClone(reviewed),approvalReason=reason.trim();
 const current=await preview({backup:source});if(canonical(binding(current))!==canonical(binding(review)))throw Error('검토 이후 공유 자료·백업·승인 계정이 변경되었습니다. 다시 검사하세요');
 const {readMetadataBackup}=await import('./backup.mjs');const parsed=await readMetadataBackup(JSON.stringify(source));
 const projectIds=new Set(current.projects.filter(p=>p.action==='REQUIRES_APPROVED_CREATE').map(p=>p.projectId));
 const visitIds=new Set(current.visits.filter(v=>v.action==='REQUIRES_APPROVED_CREATE').map(v=>v.visitId));
 const projects=parsed.archive.projects.filter(p=>projectIds.has(p.id));const visits=(parsed.visits??[]).filter(v=>visitIds.has(v.id));
 for(const visit of visits){if(visit.projectId&&!projectIds.has(visit.projectId))throw Error('신규 방문 기록의 프로젝트가 기존 공유 자료와 충돌합니다. 별도 연결 검토가 필요합니다');if(visit.originalVisitId&&!visitIds.has(visit.originalVisitId))throw Error('재방문 원본이 기존 공유 기록과 충돌합니다. 별도 연결 검토가 필요합니다');}
 const plan={kind:'BRING_RND_SHARED_RESTORE_APPROVAL_PLAN',version:1,scope:'metadata-only',actorUid:current.actorUid,reason:approvalReason,backupArchiveSHA256:current.backupArchiveSHA256,reviewedBinding:binding(current),projects,visits};
 return {...plan,planSHA256:createHash('sha256').update(canonical(plan)).digest('hex'),canApply:false,requiredNextStep:'Atomic shared snapshot re-read, approved restore authorization and compare-and-swap commit'};
}
async function prepareAtomicRestoreApproval({backup,reviewed,reason,access,readSnapshot}){
 const source=structuredClone(backup),review=structuredClone(reviewed);const initial=await access();if(!initial?.uid||!initial.email||initial.role!=='admin'||initial.mustChangePassword)throw Error('공유 복원 승인은 관리자만 가능합니다');const actor={...initial};const snapshot=structuredClone(await readSnapshot());if(snapshot.actorUid!==actor.uid||typeof snapshot.etag!=='string'||!snapshot.etag||!/^[0-9a-f]{64}$/.test(snapshot.contentSHA256??''))throw Error('공유 복원 스냅샷 검증 실패');
 const preview=require('./shared-restore-preview').createSharedRestorePreview({access:async()=>{const now=await access();if(now?.uid!==actor.uid||now?.email!==actor.email||now?.role!==actor.role)throw Error('로그인 세션이 변경되었습니다');return now;},list:async key=>{const records=snapshot.value?.[key];if(records!==undefined&&records!==null&&(typeof records!=='object'||Array.isArray(records)))throw Error('공유 스냅샷 목록 형식 오류');return Object.values(records??{});}});
 const plan=await prepareSharedRestoreApproval({backup:source,reviewed:review,reason,preview});const bound={...plan,snapshotETag:snapshot.etag,snapshotSHA256:snapshot.contentSHA256};return {...bound,atomicPlanSHA256:createHash('sha256').update(canonical(bound)).digest('hex')};
}
module.exports={prepareSharedRestoreApproval,prepareAtomicRestoreApproval};
