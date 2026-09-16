import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {resolve} from 'node:path';
type RecordValue=Record<string,unknown>;
interface Actor{uid:string;email:string;role:'member'|'admin';mustChangePassword?:boolean;}
interface Version{providerFileId:string;versionId:string;artifactId:string;sha256:string;projectId:string;}
/** Build-owned module directory only; never request data. Keeps the actual CRM core/relative import layout. */
export function createServerCSVRuntime(directory=new URL('./csv-runtime/',import.meta.url)){
 const require=createRequire(import.meta.url),folder=fileURLToPath(directory),audit=require(resolve(folder,'rnd-control/csv-import-audit.js')),ledger=require(resolve(folder,'rnd-control/csv-job-ledger.js')),drive=require(resolve(folder,'rnd-control/drive.js'));
 function bounded(input:unknown){const owned=structuredClone(input);if(!owned||typeof owned!=='object'||Array.isArray(owned)||Buffer.byteLength(JSON.stringify(owned))>audit.MAX_AUDIT_BYTES)throw Error('CSV server metadata request bounds');return owned;}
 return{digest:(value:unknown):string=>ledger.csvJobDigest(value),buildAudit:(input:RecordValue):Promise<RecordValue>=>audit.buildCSVImportAudit(bounded(input)),validateAudit:(input:unknown):Promise<RecordValue>=>audit.validateCSVImportAudit(bounded(input)),companyDrive:(options:{actor:Actor;fetch?:typeof globalThis.fetch})=>{const actor=structuredClone(options.actor),client=drive.createRndDrive({auth:()=>({user:actor}),fetch:options.fetch});return{connect:(token:string):Promise<RecordValue>=>client.connect(token),verifyVersion:(input:Version):Promise<RecordValue>=>client.verifyVersion(structuredClone(input)),clear:()=>client.clear()};}};
}
