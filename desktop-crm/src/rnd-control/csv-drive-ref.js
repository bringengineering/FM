function normalizeCSVDriveRef(input,job){
 const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
 const ref={projectId:input?.projectId,artifactId:input?.artifactId,versionId:input?.versionId,providerFileId:input?.providerFileId??input?.id,sha256:input?.sha256??input?.hash,sizeBytes:input?.sizeBytes??input?.size,status:input?.status??'VERIFIED'};
 const time=ref.status==='VERIFIED'?input?.verifiedAt:input?.observedAt;
 if(!['VERIFIED','UPLOADED_UNVERIFIED'].includes(ref.status)||ref.projectId!==job.source.projectId||ref.artifactId!=='csv-import-original'||ref.versionId!==job.id||!validId(ref.providerFileId)||ref.sha256!==job.source.sha256||ref.sizeBytes!==job.source.sizeBytes||typeof time!=='string'||!Number.isFinite(Date.parse(time))||new Date(time).toISOString()!==time)throw Error('CSV Drive 복구 연결 검증 실패');
 if(ref.status==='VERIFIED')ref.verifiedAt=time;else ref.observedAt=time;
 return ref;
}
module.exports={normalizeCSVDriveRef};
