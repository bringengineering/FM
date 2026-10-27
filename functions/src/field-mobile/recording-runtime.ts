import { getDatabase } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';
import { assert, hash, RecordingError } from './recording-model.js';
import { firebaseCustomerSiteReads } from './firebase-reads.js';
import { createRecordingDrive } from './recording-drive.js';
import { renderRecordingPdf } from './recording-pdf.js';
import type { RecordingDependencies, RecordingStore } from './recording-service.js';

export function recordingRuntime(config:{clientId:string;clientSecret:string;refreshToken:string;photosRoot:string;reportsRoot:string},recheck:()=>Promise<void>):RecordingDependencies{
  const database=getDatabase(),bucket=getStorage().bucket('bring-fm.firebasestorage.app');
  const store:RecordingStore={
    async get<T>(path:string){const raw=(await database.ref(path).get()).val();return raw?JSON.parse(raw.json) as T:null;},
    async change<T>(path:string,update:(old:T|null)=>T){const result=await database.ref(path).transaction(old=>({json:JSON.stringify(update(old?JSON.parse(old.json):null))}));assert(result.committed,'REVISION_CONFLICT',409);return JSON.parse(result.snapshot.val().json) as T;},
    async commit(report,document){
      // These IDs include the immutable mobile revision. Never overwrite a CRM
      // edit or a previous archive when a request is retried.
      for(const [path,value] of [[`crmCompany/workReports/${report.id}`,report],[`crmCompany/data/buildingDocuments/${document.id}`,document]] as const){
        await database.ref(path).transaction(old=>{if(old){assert(hash(JSON.stringify(sort(old)))===hash(JSON.stringify(sort(value))),'CRM_RECORD_CHANGED',409);return old;}return value;});
      }
    },
  };
  function sort(value:any):any{if(value&&typeof value==='object'){const entries=Object.keys(value).sort().map(k=>[k,sort(value[k])] as const).filter(([,v])=>v!==null&&v!==undefined);return entries.length?Object.fromEntries(entries):null;}return value;}
  const blobs={
    async putOnce(path:string,bytes:Buffer){const file=bucket.file(path);try{await file.save(bytes,{resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:path.endsWith('.pdf')?'application/pdf':'application/octet-stream',cacheControl:'private, no-store'}});return bytes;}catch(error){if((error as {code?:number}).code!==412)throw new RecordingError('UPLOAD_STORAGE_UNAVAILABLE',503);return(await file.download({validation:'crc32c'}))[0];}},
    async read(path:string){try{return(await bucket.file(path).download({validation:'crc32c'}))[0];}catch{throw new RecordingError('UPLOAD_STORAGE_UNAVAILABLE',503);}},
    async remove(path:string){assert(path.startsWith('field-mobile-staging/'));await bucket.file(path).delete({ignoreNotFound:true});},
  };
  return{store,blobs,sites:firebaseCustomerSiteReads(database),drive:createRecordingDrive(config,store),recheck,pdf:renderRecordingPdf,
    async validateJpeg(bytes,photo){try{const img=sharp(bytes,{failOn:'warning',limitInputPixels:2400*2400}),metadata=await img.metadata();assert(metadata.format==='jpeg'&&metadata.width===photo.width&&metadata.height===photo.height&&!metadata.exif&&!metadata.xmp,'PHOTO_INVALID',422);await img.raw().toBuffer();}catch{throw new RecordingError('PHOTO_INVALID',422);}},
  };
}
