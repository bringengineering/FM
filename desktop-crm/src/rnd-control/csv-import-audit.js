const Core=require('../core'),{validateCSVJob,csvJobDigest,csvJobLimits}=require('./csv-job-ledger'),{normalizeCSVDriveRef}=require('./csv-drive-ref');
const MAX_AUDIT_BYTES=32*1024*1024,MAX_VERIFICATION_AGE_MS=5*60*1000;
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
async function buildCSVImportAudit(input){
 const owned=structuredClone(input),{job,publisher,at,projectRevision}=owned??{};
 if(!iso(at)||!Number.isSafeInteger(projectRevision)||projectRevision<1)throw Error('CSV 공유 감사 시각·프로젝트 버전 오류');
 Core.assertMutationAllowed(publisher);Core.assertNoProhibitedSecrets(publisher);
 const jobJSON=JSON.stringify(job);if(!jobJSON||Buffer.byteLength(jobJSON)>csvJobLimits.manifestBytes)throw Error('CSV 감사 명세 용량 한도');await validateCSVJob(job);
 if(publisher.uid!==job.actorUid||publisher.email!==job.actorEmail||!['member','admin'].includes(publisher.role))throw Error('CSV 가져오기 원래 승인 계정만 감사 명세를 준비합니다');
 const driveReference=normalizeCSVDriveRef(owned.driveReference,job),age=Date.parse(at)-Date.parse(driveReference.verifiedAt);
 if(driveReference.status!=='VERIFIED'||!Number.isFinite(age)||age<0||age>MAX_VERIFICATION_AGE_MS)throw Error('CSV 공유 감사 준비 전에 회사 Drive 원본을 다시 검증하세요');
 const dryRun={policy:job.duplicatePolicy,errors:[],additions:job.drafts.map(d=>({id:d.data.id,sha256:d.sha256,sourceRevision:d.sourceRevision})),conflicts:job.conflicts,skippedIds:job.skippedIds};
 const body={kind:'BRING_RND_CSV_IMPORT_AUDIT',version:1,id:job.id,projectId:job.source.projectId,projectRevision,status:'LOCAL_DRAFTS_RECORDED',cloudVisitWrites:false,publishedByUID:publisher.uid,publishedByEmail:publisher.email,publishedByRole:publisher.role,publishedAt:at,sourceSHA256:job.source.sha256,importJobSHA256:csvJobDigest(job),importJobJSON:jobJSON,driveReference,dryRunJSON:JSON.stringify(dryRun),rollbackManifestJSON:JSON.stringify(job.rollbackManifest)};
 const audit={...body,integritySHA256:csvJobDigest(body)};if(Buffer.byteLength(JSON.stringify(audit))>MAX_AUDIT_BYTES)throw Error('CSV 공유 감사 전체 용량 한도');return audit;
}
async function validateCSVImportAudit(input){
 const owned=structuredClone(input);if(!owned||Array.isArray(owned)||Buffer.byteLength(JSON.stringify(owned))>MAX_AUDIT_BYTES||typeof owned.importJobJSON!=='string'||Buffer.byteLength(owned.importJobJSON)>csvJobLimits.manifestBytes)throw Error('CSV 공유 감사 형식·용량 오류');
 const expected=await buildCSVImportAudit({job:JSON.parse(owned.importJobJSON),driveReference:owned.driveReference,projectRevision:owned.projectRevision,publisher:{uid:owned.publishedByUID,email:owned.publishedByEmail,role:owned.publishedByRole},at:owned.publishedAt});
 if(csvJobDigest(expected)!==csvJobDigest(owned))throw Error('CSV 공유 감사 명세·무결성 불일치');return expected;
}
module.exports={buildCSVImportAudit,validateCSVImportAudit,MAX_AUDIT_BYTES,MAX_VERIFICATION_AGE_MS};
