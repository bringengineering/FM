import { createHash } from 'node:crypto';
import { assert, hash, RecordingError } from './recording-model.js';
import type { RecordingDrive, RecordingStore } from './recording-service.js';

const ID=/^[A-Za-z0-9_-]{6,200}$/;
const API='https://www.googleapis.com/drive/v3/files';
const FOLDER='application/vnd.google-apps.folder';
async function bytesBounded(r:Response,max:number):Promise<Buffer>{
  assert(r.body,'DRIVE_UNAVAILABLE',503);const reader=r.body.getReader(),parts:Buffer[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>max){await reader.cancel();throw new RecordingError('DRIVE_RESPONSE_TOO_LARGE',503);}parts.push(Buffer.from(part.value));}}finally{reader.releaseLock();}
  return Buffer.concat(parts);
}
export function createRecordingDrive(config:{clientId:string;clientSecret:string;refreshToken:string;photosRoot:string;reportsRoot:string},store:RecordingStore,fetcher:typeof fetch=fetch):RecordingDrive {
  let token='',until=0;
  async function access(){
    if(token&&Date.now()<until)return token;
    assert(config.clientId&&config.clientSecret&&config.refreshToken,'DRIVE_NOT_CONFIGURED',503);
    const r=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20_000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshToken})});
    const p=JSON.parse((await bytesBounded(r,64*1024)).toString());
    assert(r.ok&&typeof p.access_token==='string'&&p.token_type==='Bearer','DRIVE_RECONNECT_REQUIRED',503);
    token=p.access_token;until=Date.now()+Math.min(Number(p.expires_in)||0,3600)*1000-60_000;return token;
  }
  async function request(url:string,init:RequestInit={},allow:number[]=[]){
    const r=await fetcher(url,{...init,redirect:'error',signal:AbortSignal.timeout(90_000),headers:{...init.headers,Authorization:`Bearer ${await access()}`}});
    if(!r.ok&&!allow.includes(r.status)){
      let reason='';try{const p=JSON.parse((await bytesBounded(r,64*1024)).toString());reason=String(p.error?.errors?.[0]?.reason||'');}catch{/* never reflect provider text */}
      if(r.status===401){token='';throw new RecordingError('DRIVE_RECONNECT_REQUIRED',503);}
      if(r.status===403&&reason==='storageQuotaExceeded')throw new RecordingError('DRIVE_STORAGE_FULL',503);
      throw new RecordingError(r.status===403||r.status===404?'DRIVE_FOLDER_ACCESS_REQUIRED':'DRIVE_UNAVAILABLE',503);
    }return r;
  }
  async function metadata(id:string,allowMissing=false){assert(ID.test(id),'DRIVE_NOT_CONFIGURED',503);const r=await request(`${API}/${id}?supportsAllDrives=true&fields=id,mimeType,parents,trashed,size,md5Checksum,appProperties,capabilities(canAddChildren)`,{},allowMissing?[404]:[]);return r.status===404?null:JSON.parse((await bytesBounded(r,64*1024)).toString());}
  async function root(kind:'photos'|'reports') {const id=kind==='photos'?config.photosRoot:config.reportsRoot;const m=await metadata(id);assert(m?.id===id&&m.mimeType===FOLDER&&m.trashed===false&&m.capabilities?.canAddChildren===true,'DRIVE_FOLDER_ACCESS_REQUIRED',503);return id;}
  async function generateId(){const r=await request(`${API}/generateIds?count=1&space=drive&type=files`),p=JSON.parse((await bytesBounded(r,8192)).toString());assert(Array.isArray(p.ids)&&p.ids.length===1&&ID.test(p.ids[0]),'DRIVE_UNAVAILABLE',503);return p.ids[0] as string;}
  async function folder(kind:'photos'|'reports',segments:{key:string;name:string}[]) {
    let parent=await root(kind);
    for(const segment of segments){
      const binding=hash(JSON.stringify([parent,segment.key])),path=`crmCompany/fieldMobile/folders/${binding}`;
      let saved=await store.get<{id:string}>(path);if(!saved){const candidate=await generateId();saved=await store.change(path,old=>old||{id:candidate});}
      assert(saved&&ID.test(saved.id),'DRIVE_FOLDER_ACCESS_REQUIRED',503);
      let meta=await metadata(saved.id,true);
      if(!meta){await request(`${API}?supportsAllDrives=true&fields=id`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:saved.id,name:segment.name.replace(/[\u0000-\u001f/\\]/g,' ').slice(0,120),mimeType:FOLDER,parents:[parent],appProperties:{fieldMobileFolder:binding}})},[409]);meta=await metadata(saved.id);}
      assert(meta.id===saved.id&&meta.mimeType===FOLDER&&meta.trashed===false&&meta.parents?.includes(parent)&&meta.appProperties?.fieldMobileFolder===binding&&meta.capabilities?.canAddChildren===true,'DRIVE_FOLDER_ACCESS_REQUIRED',503);
      parent=saved.id;
    }return parent;
  }
  async function upload(id:string,parent:string,name:string,mime:string,bytes:Buffer,binding:string){
    assert(ID.test(id)&&ID.test(parent)&&['image/jpeg','application/pdf'].includes(mime));
    const expectedHash=hash(bytes),md5=createHash('md5').update(bytes).digest('hex');
    let m=await metadata(id,true);
    if(!m){
      const boundary='bring_'+expectedHash;
      const meta={id,name,mimeType:mime,parents:[parent],appProperties:{fieldMobileBinding:hash(binding),sha256:expectedHash}};
      const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);
      await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id',{method:'POST',headers:{'content-type':`multipart/related; boundary=${boundary}`},body:body as unknown as BodyInit},[409]);m=await metadata(id);
    }
    assert(m?.id===id&&m.mimeType===mime&&!m.trashed&&m.parents?.includes(parent)&&Number(m.size)===bytes.length&&m.md5Checksum===md5&&m.appProperties?.fieldMobileBinding===hash(binding)&&m.appProperties?.sha256===expectedHash,'DRIVE_FILE_MISMATCH',409);
  }
  async function download(id:string,expected:{sha256:string;bytes:number}){assert(ID.test(id));const r=await request(`${API}/${id}?alt=media&supportsAllDrives=true`),bytes=await bytesBounded(r,expected.bytes);assert(bytes.length===expected.bytes&&hash(bytes)===expected.sha256,'PHOTO_INTEGRITY_FAILED',422);return bytes;}
  return{generateId,folder,upload,download,checkRoots:async()=>{await root('photos');await root('reports');}};
}
