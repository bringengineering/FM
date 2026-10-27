import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createRecordingDrive } from '../src/field-mobile/recording-drive.js';
import { hash } from '../src/field-mobile/recording-model.js';
import type { RecordingStore } from '../src/field-mobile/recording-service.js';
function fixture(){
  const records=new Map<string,any>(),files=new Map<string,any>();let serial=0,uploads=0,readonly=false,denied=false,rootStatus=0;
  const store:RecordingStore={async get(p){return records.get(p)||null;},async change(p,f){const n=f(records.get(p)||null);records.set(p,n);return n;},async commit(){throw Error('not used');}};
  const fetcher:typeof fetch=async(url,init)=>{
    const u=new URL(String(url));expect(['oauth2.googleapis.com','www.googleapis.com']).toContain(u.hostname);expect(init?.redirect).toBe('error');
    if(u.hostname==='oauth2.googleapis.com')return Response.json(denied?{error:'synthetic-private-provider-detail'}:{access_token:'synthetic',token_type:'Bearer',expires_in:3600},{status:denied?400:200});
    const id=u.pathname.split('/').at(-1)!;
    if(id==='generateIds')return Response.json({ids:[`generated-${++serial}`]});
    if(init?.method==='POST'){
      if(u.pathname.startsWith('/upload/')){const body=Buffer.from(init.body as Uint8Array).toString();const meta=JSON.parse(body.split('\r\n\r\n')[1].split('\r\n--')[0]);files.set(meta.id,{...meta,trashed:false,size:4,md5Checksum:createHash('md5').update('test').digest('hex')});uploads++;}
      else{const meta=JSON.parse(String(init.body));files.set(meta.id,{...meta,trashed:false,capabilities:{canAddChildren:true}});}return Response.json({});
    }
    if(id==='photos-root'||id==='reports-root')return rootStatus?Response.json({error:{message:'synthetic-private-provider-detail'}},{status:rootStatus}):Response.json({id,mimeType:'application/vnd.google-apps.folder',trashed:false,capabilities:{canAddChildren:!readonly}});
    return files.has(id)?Response.json(files.get(id)):Response.json({error:{}},{status:404});
  };
  return {drive:createRecordingDrive({clientId:'synthetic',clientSecret:'synthetic',refreshToken:'synthetic',photosRoot:'photos-root',reportsRoot:'reports-root'},store,fetcher),files,uploads:()=>uploads,readonly:()=>{readonly=true;},deny:()=>{denied=true;},rejectRoot:(status:number)=>{rootStatus=status;}};
}
it('pins folder IDs and reuses verified Drive uploads after a repeated request',async()=>{
  const t=fixture(),segments=[{key:'customer-a',name:'Synthetic customer'}];await t.drive.checkRoots();const folder=await t.drive.folder('photos',segments);expect(await t.drive.folder('photos',segments)).toBe(folder);
  const id=await t.drive.generateId();await t.drive.upload(id,folder,'test.jpg','image/jpeg',Buffer.from('test'),'binding');await t.drive.upload(id,folder,'test.jpg','image/jpeg',Buffer.from('test'),'binding');expect(t.uploads()).toBe(1);
  expect(t.files.get(id).appProperties.sha256).toBe(hash('test'));t.files.get(id).parents=['other-folder'];await expect(t.drive.upload(id,folder,'test.jpg','image/jpeg',Buffer.from('test'),'binding')).rejects.toThrow('DRIVE_FILE_MISMATCH');
});
it('logs only safe root access diagnostics without provider text or identifiers',async()=>{
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  try{
    const a=fixture();a.readonly();await expect(a.drive.checkRoots()).rejects.toThrow('DRIVE_FOLDER_ACCESS_REQUIRED');
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({event:'field_drive_root_check',root:'photos',idMatches:true,isFolder:true,notTrashed:true,canAddChildren:false});
    warn.mockClear();const b=fixture();b.rejectRoot(403);await expect(b.drive.checkRoots()).rejects.toThrow('DRIVE_FOLDER_ACCESS_REQUIRED');
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({event:'field_drive_root_check',root:'photos',httpStatus:403});
    expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic');
  }finally{warn.mockRestore();}
});
it('requires writable roots and never exposes Google refresh-token error details',async()=>{
  const a=fixture();a.readonly();await expect(a.drive.checkRoots()).rejects.toThrow('DRIVE_FOLDER_ACCESS_REQUIRED');
  const b=fixture();b.deny();await expect(b.drive.checkRoots()).rejects.toThrow('DRIVE_RECONNECT_REQUIRED');
});
