import {createRestoreRootUpdater,type RestoreMutation} from './restore-transaction.js';
type Root=Record<string,unknown>;interface Actor {uid:string;email:string;authTime:number;}
export interface RestoreApprovalSession {id:string;actorUid:string;actorEmail:string;actorAuthTime:number;state:'PENDING'|'COMMITTED';createdAt:number;expiresAt:number;committedAt?:number;expectedSnapshotSHA256:string;mutation:RestoreMutation;}
function record(value:unknown):value is Root{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function own(value:unknown,key:string):unknown{return record(value)&&Object.hasOwn(value,key)?value[key]:undefined;}
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function receipt(session:Root):Root|undefined{const mutation=record(session.mutation)?session.mutation:null,audit=mutation?.audit??session.audit,contentSHA256=mutation?.contentSHA256??session.contentSHA256;if(!record(audit)||audit.id!==session.id||audit.actorUid!==session.actorUid||typeof contentSHA256!=='string'||!contentSHA256)return undefined;return{id:session.id,actorUid:session.actorUid,actorEmail:session.actorEmail,actorAuthTime:session.actorAuthTime,state:'COMMITTED',createdAt:session.createdAt,expiresAt:session.expiresAt,committedAt:session.committedAt,contentSHA256,audit:structuredClone(audit)};}
/** Per-owner atomic quota and lazy cleanup. Durable restoreApprovals audit is never removed. */
export function createRestoreSessionStoreUpdater({session,now}:{session:RestoreApprovalSession;now:()=>number}){
 const incoming=structuredClone(session);if(!uuid(incoming.id)||!/^[a-zA-Z0-9_-]{1,128}$/.test(incoming.actorUid)||incoming.state!=='PENDING')throw Error('Invalid approval storage request');
 return(current:unknown):Root|undefined=>{const time=now();if(!Number.isSafeInteger(time)||time<incoming.createdAt||time>=incoming.expiresAt||incoming.expiresAt!==incoming.createdAt+600000||current!==null&&!record(current))return undefined;const owner=current??{};if(Object.hasOwn(owner,incoming.id))return undefined;
  const next:Root={};let pending=0,count=0,bytes=2;
  for(const [id,entry]of Object.entries(owner)){if(!record(entry)||!uuid(id)||entry.id!==id||entry.actorUid!==incoming.actorUid||!Number.isSafeInteger(entry.createdAt)||!Number.isSafeInteger(entry.expiresAt)||Number(entry.expiresAt)!==Number(entry.createdAt)+600000)return undefined;
   let retained:Root;if(entry.state==='PENDING'){if(time>=Number(entry.expiresAt))continue;pending++;retained=entry;}else if(entry.state==='COMMITTED'){if(!Number.isSafeInteger(entry.committedAt)||Number(entry.committedAt)<Number(entry.createdAt)||Number(entry.committedAt)>time)return undefined;if(time-Number(entry.committedAt)>=86400000)continue;const compact=receipt(entry);if(!compact)return undefined;retained=compact;}else return undefined;
   count++;bytes+=Buffer.byteLength(JSON.stringify(id)+':'+JSON.stringify(retained),'utf8')+1;if(count>=200||pending>=20||bytes>32*1024*1024)return undefined;Object.defineProperty(next,id,{value:structuredClone(retained),enumerable:true,writable:true,configurable:true});
  }
  bytes+=Buffer.byteLength(JSON.stringify(incoming.id)+':'+JSON.stringify(incoming),'utf8')+1;if(bytes>32*1024*1024)return undefined;Object.defineProperty(next,incoming.id,{value:structuredClone(incoming),enumerable:true,writable:true,configurable:true});return next;
 };
}
/** Only store a server-validated and compiled mutation. No client may write this collection. */
export function createRestoreApprovalSession({actor,mutation,expectedSnapshotSHA256,now}:{actor:Actor;mutation:RestoreMutation;expectedSnapshotSHA256:string;now:number}):RestoreApprovalSession {
 if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(now+600000)||!actor.uid||!actor.email||!Number.isSafeInteger(actor.authTime)||actor.authTime<=0||mutation.audit.actorUid!==actor.uid)throw Error('Invalid restore approval session');
 return{id:mutation.operationId,actorUid:actor.uid,actorEmail:actor.email,actorAuthTime:actor.authTime,state:'PENDING',createdAt:now,expiresAt:now+600000,expectedSnapshotSHA256,mutation:structuredClone(mutation)};
}
/** Resolve the request from server-owned state inside every root transaction retry. */
export function createRestoreSessionUpdater(input:{actor:Actor;sessionId:string;digest:(value:unknown)=>string;now:()=>number}) {
 const actor=structuredClone(input.actor),id=input.sessionId,digest=input.digest,clock=input.now;
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)||!/^[a-zA-Z0-9_-]{1,128}$/.test(actor.uid)||!actor.email)throw Error('Invalid restore session request');
 return(current:unknown):Root|undefined=>{
  if(!record(current))return undefined;const sessions=own(current,'rndRestoreSessions'),owner=own(sessions,actor.uid),stored=own(owner,id);if(!record(stored)||stored.id!==id||stored.actorUid!==actor.uid||stored.actorEmail!==actor.email||stored.actorAuthTime!==actor.authTime)return undefined;
  const session=stored as unknown as RestoreApprovalSession,time=clock();if(!Number.isSafeInteger(time)||!Number.isSafeInteger(session.createdAt)||!Number.isSafeInteger(session.expiresAt)||session.createdAt>time||session.expiresAt!==session.createdAt+600000)return undefined;
  if(session.state==='PENDING'&&time>=session.expiresAt)return undefined;if(!['PENDING','COMMITTED'].includes(session.state))return undefined;
  if(session.state==='COMMITTED'){const compact=receipt(stored);if(!compact||!Number.isSafeInteger(compact.committedAt)||Number(compact.committedAt)<session.createdAt||Number(compact.committedAt)>time)return undefined;for(const grant of [own(own(own(current,'crmCompany'),'access'),actor.uid),own(own(current,'rndAccess'),actor.uid)])if(!record(grant)||grant.enabled!==true||grant.email!==actor.email||grant.role!=='admin'||grant.mustChangePassword===true)return undefined;const rnd=own(current,'rndControl')??null;if(digest(rnd)!==compact.contentSHA256||digest(own(own(rnd,'restoreApprovals'),id))!==digest(compact.audit))return undefined;return structuredClone(current);}
  if(session.mutation?.operationId!==id)return undefined;
  let next:Root|undefined;try{next=createRestoreRootUpdater({actor,mutation:session.mutation,expectedSnapshotSHA256:session.expectedSnapshotSHA256,digest})(current);}catch{return undefined;}if(!next)return undefined;
  const updatedSessions=own(next,'rndRestoreSessions') as Root,updatedOwner=own(updatedSessions,actor.uid) as Root;Object.defineProperty(updatedOwner,id,{value:receipt({...stored,state:'COMMITTED',committedAt:time}),enumerable:true,writable:true,configurable:true});return next;
 };
}
