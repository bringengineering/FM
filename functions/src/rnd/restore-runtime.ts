import {createRequire} from 'node:module';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';import {resolve} from 'node:path';
interface Actor {uid:string;email:string;role:string;mustChangePassword?:boolean;}
interface Snapshot {value:Record<string,unknown>|null;etag:string;actorUid:string;contentSHA256:string;}
interface Access {access:()=>Promise<Actor>;}
/** Internal runtime directory is build-owned. Never take it from a client request. */
export function createServerRestoreRuntime(directory=new URL('./runtime/',import.meta.url)) {
 const require=createRequire(import.meta.url),folder=fileURLToPath(directory);const preview=require(resolve(folder,'shared-restore-preview.js')).createSharedRestorePreview;const prepare=require(resolve(folder,'shared-restore-approval.js')).prepareAtomicRestoreApproval;const compile=require(resolve(folder,'restore-mutation.js')).createRestoreMutation;const fingerprint=require(resolve(folder,'repository.js')).researchFingerprint;
 function bounded(input:Record<string,unknown>,limit=16*1024*1024){const copy=structuredClone(input);const encoded=JSON.stringify(copy);if(Buffer.byteLength(encoded,'utf8')>limit)throw Error('복원 메타데이터 요청 크기 제한 초과');return copy;}
 /** Internal authenticated/approved caller only. Does not authorize, write, or register an endpoint. */
 const compileOriginal=(input:Record<string,unknown>)=>require(fileURLToPath(new URL('../original-runtime/rnd-control/original-restore-mutation.js',directory))).createOriginalRestoreMutation(bounded(input,32*1024*1024));
 return {compileOriginal,digest:(value:unknown):string=>createHash('sha256').update(fingerprint(value)).digest('hex'),preview:(input:Record<string,unknown>,dependencies:Access & {list:(key:string)=>Promise<unknown[]>})=>preview(dependencies)(bounded(input)),prepare:(input:Record<string,unknown>,dependencies:Access & {readSnapshot:()=>Promise<Snapshot>})=>prepare({...bounded(input),...dependencies}),compile:(input:Record<string,unknown>)=>compile(bounded(input))};
}
