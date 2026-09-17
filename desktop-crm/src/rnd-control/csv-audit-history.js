const {validateCSVImportAudit}=require('./csv-import-audit');
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
function assertReader(actor){if(!actor||!validId(actor.uid)||typeof actor.email!=='string'||!actor.email||!['admin','member','viewer'].includes(actor.role)||actor.mustChangePassword===true)throw Error('승인된 R&D 조회 권한이 필요합니다');}
/** access/readAudit are trusted Main dependencies; validator verifies consistency, not live Drive or publication origin. */
function createCSVAuditHistory({access,captureSession,isCurrent,readAudit,validateAudit=validateCSVImportAudit}){return async input=>{
 const owned=structuredClone(input);if(!owned||Array.isArray(owned)||Object.keys(owned).length!==2||Object.keys(owned).some(k=>!['projectId','jobId'].includes(k))||!validId(owned.projectId)||!validId(owned.jobId))throw Error('CSV 공유 감사 조회 요청 오류');
 const binding=captureSession(),actor=structuredClone(await access());assertReader(actor);
 const check=async()=>{if(!isCurrent(binding))throw Error('로그인 세션이 변경되었습니다');const current=await access();assertReader(current);if(!isCurrent(binding)||current.uid!==actor.uid||current.email!==actor.email||current.role!==actor.role)throw Error('로그인 세션이 변경되었습니다');};
 await check();const raw=structuredClone(await readAudit(owned.jobId));await check();const audit=structuredClone(await validateAudit(raw));await check();if(audit.id!==owned.jobId||audit.projectId!==owned.projectId)throw Error('CSV 감사 프로젝트·작업 연결 오류');
 const job=JSON.parse(audit.importJobJSON),dryRun=JSON.parse(audit.dryRunJSON);
 const summary={scope:'csv-shared-audit-history',readOnly:true,id:audit.id,projectId:audit.projectId,projectRevision:audit.projectRevision,publishedAt:audit.publishedAt,publishedByUID:audit.publishedByUID,publishedByEmail:audit.publishedByEmail,publishedByRole:audit.publishedByRole,auditSHA256:audit.integritySHA256,source:Object.fromEntries(['fileName','ledger','extractedAt','sha256','sizeBytes','mapping','units'].map(key=>[key,job.source[key]])),driveReference:{...audit.driveReference,url:`https://drive.google.com/file/d/${audit.driveReference.providerFileId}/view`},totals:{additions:dryRun.additions.length,conflicts:dryRun.conflicts.length,skipped:dryRun.skippedIds.length},additions:dryRun.additions.slice(0,50),conflicts:dryRun.conflicts.slice(0,50),skippedIds:dryRun.skippedIds.slice(0,50)};await check();return summary;
};}
module.exports={createCSVAuditHistory};
