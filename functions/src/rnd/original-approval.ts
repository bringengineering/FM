import {createHash,randomUUID} from 'node:crypto';
import type {RestoreAuthenticatedActor} from './restore-auth.js';
import {createRestoreApprovalSession} from './restore-session.js';
import type {RestoreMutation} from './restore-transaction.js';
interface Snapshot {actorUid:string;etag:string;value:Record<string,unknown>|null;contentSHA256:string;}
interface Dependencies {
 authenticate:()=>Promise<RestoreAuthenticatedActor>;
 /** Server-owned source/Drive verification pipeline, never request preparation. */
 prepare:(actor:RestoreAuthenticatedActor)=>Promise<Record<string,unknown>>;
 readSnapshot:(actor:RestoreAuthenticatedActor)=>Promise<Snapshot>;
 runtime:{compileOriginal:(input:Record<string,unknown>)=>Promise<RestoreMutation>};
 now:()=>number;
}
/** Internal orchestration only. Does not register an endpoint or persist a session.
 * Authentication, source verification and snapshot readers must be server-owned. */
export async function prepareOriginalApprovalSession(input:Record<string,unknown>,d:Dependencies){
 const request=structuredClone(input);
 if(!request||Array.isArray(request)||Object.keys(request).length!==2||Object.keys(request).some(k=>!['reason','additionalMetadataAction'].includes(k))||typeof request.reason!=='string'||!request.reason.trim()||request.reason.length>4000||(typeof request.additionalMetadataAction!=='string'||!['NONE','ARCHIVE_ONLY'].includes(request.additionalMetadataAction)))throw Error('Invalid original restore approval request');
 const actor=structuredClone(await d.authenticate());
 const check=async()=>{const current=await d.authenticate();if(current.uid!==actor.uid||current.email!==actor.email||current.authTime!==actor.authTime||current.role!=='admin'||current.mustChangePassword!==false)throw Error('Original restore login or approval changed');};
 if(actor.role!=='admin'||actor.mustChangePassword!==false)throw Error('Original restore administrator required');
 const preparation=structuredClone(await d.prepare(structuredClone(actor)));await check();
 const snapshot=structuredClone(await d.readSnapshot(structuredClone(actor)));await check();
 const now=d.now();if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid approval clock');
 const approval={kind:'BRING_RND_ORIGINAL_RESTORE_APPROVAL',version:1,approved:true,actorUid:actor.uid,operationId:randomUUID(),at:new Date(now).toISOString(),reason:request.reason,preparedSHA256:createHash('sha256').update(JSON.stringify(preparation)).digest('hex'),snapshotSHA256:snapshot.contentSHA256,additionalMetadataAction:request.additionalMetadataAction};
 const mutation=await d.runtime.compileOriginal({snapshot,preparation,approval});await check();
 return createRestoreApprovalSession({actor,mutation,expectedSnapshotSHA256:snapshot.contentSHA256,now});
}
