const {validateCSVImportAudit}=require('./csv-import-audit');
function collection(value){if(value==null)return[];if(typeof value!=='object'||Array.isArray(value))throw Error('백업 공유 자료 collection 형식 오류');return Object.entries(value).map(([id,row])=>{if(!row||row.id!==id)throw Error('백업 공유 자료 ID 연결 오류');return row;});}
async function prepareOriginalBackupSnapshot(input,selectedId){
 const value=structuredClone(input);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('백업 공유 snapshot 형식 오류');
 const {hydrateProject}=await import('./archive.mjs'),{createMetadataBackup}=await import('./backup.mjs'),{verifyDatasetManifest}=await import('./dataset.mjs');
 const projects=collection(value.projects).map(hydrateProject);if(!projects.some(p=>p.id===selectedId))throw Error('백업 공유 프로젝트 선택 오류');
 for(const project of projects)for(const dataset of project.research?.datasetSnapshots??[]){if(dataset.projectId!==project.id)throw Error('백업 데이터셋 프로젝트 연결 오류');if(!verifyDatasetManifest(dataset))throw Error('백업 동결 데이터셋 manifest 오류');}
 const visits=collection(value.visits),importJobs=[];
 for(const audit of collection(value.importJobs)){const verified=await validateCSVImportAudit(audit);if(!projects.some(p=>p.id===verified.projectId))throw Error('백업 감사 프로젝트 연결 오류');importJobs.push(verified);}
 const metadataBackup=await createMetadataBackup(projects,selectedId,visits);
 return{projects,visits,importJobs,selectedId,metadataManifest:metadataBackup.manifest,additionalMetadata:Object.fromEntries(Object.entries(value).filter(([key])=>!['projects','visits','importJobs'].includes(key)))};
}
module.exports={prepareOriginalBackupSnapshot};
