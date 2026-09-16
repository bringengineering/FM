import {compileCSVImportPublication,createCSVImportRootUpdater,type CompiledCSVImportPublication} from './csv-import-transaction.js';
import type {CSVImportAuthenticatedPublisher} from './csv-import-auth.js';
import {createServerCSVRuntime} from './csv-import-runtime.js';
type RecordValue=Record<string,unknown>;
const record=(v:unknown):v is RecordValue=>!!v&&typeof v==='object'&&!Array.isArray(v);
export class CSVImportCommitUncertainError extends Error{constructor(){super('CSV audit commit outcome unknown; check same job before retry');this.name='CSVImportCommitUncertainError';}}
interface Dependencies{authenticate:()=>Promise<CSVImportAuthenticatedPublisher>;readAudit:(id:string)=>Promise<unknown>;runtime:ReturnType<typeof createServerCSVRuntime>;prepare:(input:unknown)=>Promise<CompiledCSVImportPublication>;transaction:(update:(current:unknown)=>RecordValue|undefined)=>Promise<{committed:boolean;value:unknown}>;}
/** Server-owned SDK dependencies only. Existing audit is read from server DB, never supplied as request data. */
export async function publishCSVImport(input:unknown,dependencies:Dependencies){
 const owned=structuredClone(input);if(!record(owned)||Object.keys(owned).some(k=>!['job','providerFileId','driveToken'].includes(k))||typeof owned.providerFileId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(owned.providerFileId)||typeof owned.driveToken!=='string'||!owned.driveToken||owned.driveToken.length>16384)throw Error('CSV publication request invalid');
 const {authenticate,readAudit,runtime,prepare,transaction}=dependencies;
 const actor=await authenticate(),job=await runtime.validateJob(owned.job);
 if(job.actorUid!==actor.uid||job.actorEmail!==actor.email||typeof job.id!=='string')throw Error('CSV publication original owner required');
 const existing=await readAudit(job.id);let publication:CompiledCSVImportPublication;
 if(existing!==null&&existing!==undefined){const audit=await runtime.validateAudit(existing);if(audit.importJobSHA256!==runtime.digest(job)||!record(audit.driveReference)||audit.driveReference.providerFileId!==owned.providerFileId)throw Error('CSV publication same job collision');publication=await compileCSVImportPublication({actor,audit,validateAudit:runtime.validateAudit,digest:runtime.digest});}
 else publication=await prepare(owned);
 const fresh=await authenticate();if(fresh.uid!==actor.uid||fresh.email!==actor.email||fresh.role!==actor.role||fresh.authTime!==actor.authTime)throw Error('CSV publication account changed');
 const update=createCSVImportRootUpdater(publication);let result:{committed:boolean;value:unknown};
 try{result=await transaction(update);}catch{throw new CSVImportCommitUncertainError();}
 if(!result.committed)throw Error('CSV publication not committed: permission, project or collision changed');
 const value=result.value,control=record(value)?value.rndControl:undefined,jobs=record(control)?control.importJobs:undefined,audit=record(jobs)?jobs[publication.id]:undefined;
 if(!audit||runtime.digest(audit)!==publication.contentSHA256)throw new CSVImportCommitUncertainError();
 return{id:publication.id,projectId:publication.projectId,status:'RECORDED' as const,contentSHA256:publication.contentSHA256};
}
