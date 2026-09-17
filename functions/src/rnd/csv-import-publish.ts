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
 const providerFileId=owned.providerFileId;
 const {authenticate,readAudit,runtime,prepare,transaction}=dependencies;
 const actor=await authenticate(),job=await runtime.validateJob(owned.job);
 if(job.actorUid!==actor.uid||job.actorEmail!==actor.email||typeof job.id!=='string')throw Error('CSV publication original owner required');
 async function storedPublication(value:unknown){const audit=await runtime.validateAudit(value);if(audit.importJobSHA256!==runtime.digest(job)||!record(audit.driveReference)||audit.driveReference.providerFileId!==providerFileId)throw Error('CSV publication same job collision');return compileCSVImportPublication({actor,audit,validateAudit:runtime.validateAudit,digest:runtime.digest});}
 async function reauthenticate(){const fresh=await authenticate();if(fresh.uid!==actor.uid||fresh.email!==actor.email||fresh.role!==actor.role||fresh.authTime!==actor.authTime)throw Error('CSV publication account changed');}
 async function commit(publication:CompiledCSVImportPublication){await reauthenticate();const update=createCSVImportRootUpdater(publication,{acknowledgeSameJob:true});try{return await transaction(update);}catch{throw new CSVImportCommitUncertainError();}}
 const existing=await readAudit(job.id);let publication:CompiledCSVImportPublication;
 if(existing!==null&&existing!==undefined)publication=await storedPublication(existing);
 else publication=await prepare(owned);
 let result=await commit(publication);
 // One bounded confirmation attempt only. Never reprepare/reapply a failed new write.
 if(!result.committed&&existing==null){const winner=await readAudit(job.id);if(winner!==null&&winner!==undefined){publication=await storedPublication(winner);result=await commit(publication);}}
 if(!result.committed)throw Error('CSV publication not committed: permission, project or collision changed');
 const value=result.value,control=record(value)?value.rndControl:undefined,jobs=record(control)?control.importJobs:undefined,audit=record(jobs)?jobs[publication.id]:undefined;
 if(!audit)throw new CSVImportCommitUncertainError();let confirmed:RecordValue;try{confirmed=await runtime.validateAudit(audit);await storedPublication(confirmed);}catch{throw new CSVImportCommitUncertainError();}
 return{id:publication.id,projectId:publication.projectId,status:'RECORDED' as const,contentSHA256:runtime.digest(confirmed)};
}
