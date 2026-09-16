type RecordValue=Record<string,unknown>;
function record(value:unknown):value is RecordValue{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function child(value:unknown,key:string):unknown{return record(value)&&Object.hasOwn(value,key)?value[key]:undefined;}
interface CSVActor{uid:string;email:string;role:'member'|'admin';}
export interface CompiledCSVImportPublication{readonly id:string;readonly projectId:string;readonly contentSHA256:string;}
interface InternalPublication{actor:CSVActor;audit:RecordValue;digest:(value:unknown)=>string;contentSHA256:string;}
const compiled=new WeakMap<object,InternalPublication>();
/** Trusted-server only: validator must be authoritative; authenticate actor/Drive before compilation. No endpoint accepts this handle or validator from request data. */
export async function compileCSVImportPublication(input:{actor:CSVActor;audit:unknown;validateAudit:(value:unknown)=>Promise<RecordValue>;digest:(value:unknown)=>string}):Promise<CompiledCSVImportPublication>{
 const actor=structuredClone(input.actor),candidate=structuredClone(input.audit),digest=input.digest,validate=input.validateAudit;
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(actor.uid)||typeof actor.email!=='string'||!actor.email.includes('@')||!['member','admin'].includes(actor.role))throw Error('CSV publication actor invalid');
 if(!record(candidate)||Buffer.byteLength(JSON.stringify(candidate))>32*1024*1024)throw Error('CSV publication payload invalid');
 const audit=structuredClone(await validate(candidate));if(!record(audit))throw Error('CSV publication validation missing');
 const {integritySHA256,...body}=audit;
 if(audit.kind!=='BRING_RND_CSV_IMPORT_AUDIT'||audit.version!==1||typeof audit.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(audit.id)||typeof audit.projectId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(audit.projectId)||!Number.isSafeInteger(audit.projectRevision)||Number(audit.projectRevision)<1||audit.publishedByUID!==actor.uid||audit.publishedByEmail!==actor.email||!['member','admin'].includes(String(audit.publishedByRole))||audit.status!=='LOCAL_DRAFTS_RECORDED'||audit.cloudVisitWrites!==false||typeof integritySHA256!=='string'||!/^[a-f0-9]{64}$/.test(integritySHA256)||digest(body)!==integritySHA256)throw Error('CSV compiled audit binding invalid');
 const contentSHA256=digest(audit);if(!/^[a-f0-9]{64}$/.test(contentSHA256))throw Error('CSV publication digest invalid');
 const handle=Object.freeze({id:audit.id,projectId:audit.projectId,contentSHA256});compiled.set(handle,{actor,audit,digest,contentSHA256});return handle;
}
/** Append-only root updater. Rechecks both approvals/project on every Admin SDK transaction retry. */
export function createCSVImportRootUpdater(publication:CompiledCSVImportPublication){
 const owned=compiled.get(publication);if(!owned)throw Error('CSV private compiled publication required');
 const actor=structuredClone(owned.actor),audit=structuredClone(owned.audit),digest=owned.digest,expected=owned.contentSHA256;
 return(current:unknown):RecordValue|undefined=>{
  if(!record(current))return undefined;
  const crm=child(child(child(current,'crmCompany'),'access'),actor.uid),rnd=child(child(current,'rndAccess'),actor.uid);
  for(const grant of [crm,rnd])if(!record(grant)||grant.enabled!==true||grant.email!==actor.email||grant.role!==actor.role||grant.mustChangePassword===true)return undefined;
  const control=child(current,'rndControl');if(!record(control))return undefined;
  const jobs=child(control,'importJobs');if(jobs!==undefined&&jobs!==null&&!record(jobs))return undefined;
  const existing=child(jobs,String(audit.id));
  if(existing!==undefined)return digest(existing)===expected?structuredClone(current):undefined;
  const project=child(child(control,'projects'),String(audit.projectId));if(!record(project)||project.id!==audit.projectId||project.revision!==audit.projectRevision||audit.publishedByRole!==actor.role)return undefined;
  const next=structuredClone(current),nextControl=next.rndControl as RecordValue;nextControl.importJobs={...(record(jobs)?structuredClone(jobs):{}),[String(audit.id)]:structuredClone(audit)};return next;
 };
}
