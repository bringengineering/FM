import {compileCSVImportPublication,type CompiledCSVImportPublication} from './csv-import-transaction.js';
import type {CSVImportAuthenticatedPublisher} from './csv-import-auth.js';
import {createServerCSVRuntime} from './csv-import-runtime.js';
type RecordValue=Record<string,unknown>;
function record(value:unknown):value is RecordValue{return !!value&&typeof value==='object'&&!Array.isArray(value);}
interface Dependencies{authenticate:()=>Promise<CSVImportAuthenticatedPublisher>;readProject:(id:string)=>Promise<unknown>;readVisits:(projectId:string)=>Promise<RecordValue[]>;now:()=>string;runtime:ReturnType<typeof createServerCSVRuntime>;compile?:typeof compileCSVImportPublication;}
/** Internal operation only. Authenticate closure must use verified callable identity; runtime/clock/compile are server-owned. No database write here. */
export async function prepareCSVImportPublication(input:unknown,dependencies:Dependencies):Promise<CompiledCSVImportPublication>{
 const owned=structuredClone(input);if(!record(owned)||Object.keys(owned).some(key=>!['job','providerFileId','driveToken'].includes(key))||typeof owned.providerFileId!=='string'||! /^[a-zA-Z0-9_-]{1,256}$/.test(owned.providerFileId)||typeof owned.driveToken!=='string'||!owned.driveToken||owned.driveToken.length>16384)throw Error('CSV publication request invalid');
 const authenticate=dependencies.authenticate,readProject=dependencies.readProject,readVisits=dependencies.readVisits,now=dependencies.now,runtime=dependencies.runtime,compile=dependencies.compile??compileCSVImportPublication;
 const actor=await authenticate(),job=await runtime.validateJob(owned.job),source=job.source;
 if(job.actorUid!==actor.uid||job.actorEmail!==actor.email||!record(source)||typeof source.projectId!=='string'||typeof job.id!=='string'||typeof source.sha256!=='string')throw Error('CSV publication original owner required');
 const project=await readProject(source.projectId);if(!record(project)||project.id!==source.projectId||!Number.isSafeInteger(project.revision)||Number(project.revision)<1)throw Error('CSV publication project unavailable');
 const client=runtime.companyDrive({actor});
 try{
  await client.connect(owned.driveToken);
  const original=await client.verifyCSVOriginal({projectId:source.projectId,artifactId:'csv-import-original',versionId:job.id,providerFileId:owned.providerFileId,sha256:source.sha256});
  await runtime.verifySourceDerivation(job,original.bytes,await readVisits(source.projectId));
  const reference=original.reference;
  const fresh=await authenticate();if(fresh.uid!==actor.uid||fresh.email!==actor.email||fresh.role!==actor.role||fresh.authTime!==actor.authTime)throw Error('CSV publication account changed');
  const audit=await runtime.buildAudit({job,driveReference:reference,publisher:fresh,projectRevision:project.revision,at:now()});
  const latest=await readProject(source.projectId);if(!record(latest)||latest.id!==project.id||latest.revision!==project.revision)throw Error('CSV publication project changed');
  return await compile({actor:fresh,audit,validateAudit:runtime.validateAudit,digest:runtime.digest});
 }finally{client.clear();owned.driveToken='';}
}
