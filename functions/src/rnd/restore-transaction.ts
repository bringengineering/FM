import type {Reference,DataSnapshot} from 'firebase-admin/database';
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function child(value: unknown, key: string): unknown { return record(value) && Object.hasOwn(value,key) ? value[key] : undefined; }
export interface RestoreMutation { value: RecordValue; operationId: string; audit: RecordValue; contentSHA256: string; }
/** Internal trusted-server helper. Never accept a client-supplied mutation or digest. */
export function createRestoreRootUpdater(input: {actor: {uid: string; email: string}; mutation: RestoreMutation; expectedSnapshotSHA256: string; digest: (value: unknown) => string}) {
 const actor=structuredClone(input.actor),mutation=structuredClone(input.mutation),expected=input.expectedSnapshotSHA256,digest=input.digest;
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(actor.uid)||!actor.email||mutation.audit.actorUid!==actor.uid)throw Error('Restore actor binding invalid');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mutation.operationId)||mutation.audit.id!==mutation.operationId||digest(mutation.value)!==mutation.contentSHA256||digest(child(child(mutation.value,'restoreApprovals'),mutation.operationId))!==digest(mutation.audit))throw Error('Restore compiled mutation binding invalid');
 return (current: unknown): RecordValue | undefined => {
  if(!record(current))return undefined;
  const crm=child(child(child(current,'crmCompany'),'access'),actor.uid),rnd=child(child(current,'rndAccess'),actor.uid);
  for(const grant of [crm,rnd])if(!record(grant)||grant.enabled!==true||grant.email!==actor.email||grant.role!=='admin'||grant.mustChangePassword===true)return undefined;
  const currentRnd=child(current,'rndControl')??null,observed=digest(currentRnd);
  if(observed===mutation.contentSHA256&&digest(child(child(currentRnd,'restoreApprovals'),mutation.operationId))===digest(mutation.audit))return structuredClone(current);
  if(observed!==expected)return undefined;
  const next=structuredClone(current);next.rndControl=structuredClone(mutation.value);return next;
 };
}

/** Keep a scoped listener so SDK local cache is populated for the initial transaction callback. */
export async function runRestoreRootTransaction(root: Reference,update: (current: unknown) => RecordValue | undefined): Promise<{committed:boolean;snapshot:DataSnapshot}> {
 let resolveReady: () => void = ()=>{};let rejectReady: (error: Error) => void = ()=>{};
 const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 const listener=(_snapshot: DataSnapshot)=>resolveReady();const timer=setTimeout(()=>rejectReady(Error('Restore root read timed out')),20000);
 try{root.on('value',listener,rejectReady);await ready;clearTimeout(timer);return await root.transaction(update,undefined,false);}
 finally{clearTimeout(timer);root.off('value',listener);}
}
