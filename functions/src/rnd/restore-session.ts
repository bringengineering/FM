import {createRestoreRootUpdater,type RestoreMutation} from './restore-transaction.js';
type Root=Record<string,unknown>;interface Actor {uid:string;email:string;authTime:number;}
export interface RestoreApprovalSession {id:string;actorUid:string;actorEmail:string;actorAuthTime:number;state:'PENDING'|'COMMITTED';createdAt:number;expiresAt:number;committedAt?:number;expectedSnapshotSHA256:string;mutation:RestoreMutation;}
function record(value:unknown):value is Root{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function own(value:unknown,key:string):unknown{return record(value)&&Object.hasOwn(value,key)?value[key]:undefined;}
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
  const session=stored as unknown as RestoreApprovalSession,time=clock();if(!Number.isSafeInteger(time)||!Number.isSafeInteger(session.createdAt)||!Number.isSafeInteger(session.expiresAt)||session.createdAt>time||session.expiresAt!==session.createdAt+600000||session.mutation?.operationId!==id)return undefined;
  if(session.state==='PENDING'&&time>=session.expiresAt)return undefined;if(!['PENDING','COMMITTED'].includes(session.state))return undefined;
  if(session.state==='COMMITTED'&&digest(own(current,'rndControl')??null)!==session.mutation.contentSHA256)return undefined;
  let next:Root|undefined;try{next=createRestoreRootUpdater({actor,mutation:session.mutation,expectedSnapshotSHA256:session.expectedSnapshotSHA256,digest})(current);}catch{return undefined;}if(!next)return undefined;
  if(session.state==='COMMITTED')return next;
  const updatedSessions=own(next,'rndRestoreSessions') as Root,updatedOwner=own(updatedSessions,actor.uid) as Root;Object.defineProperty(updatedOwner,id,{value:{...structuredClone(session),state:'COMMITTED',committedAt:time},enumerable:true,writable:true,configurable:true});return next;
 };
}
