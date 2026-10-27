import { authorizeMobile, MobileAccessError, type MobileActor, type MobileAuthDependencies } from './access.js';
import { SiteError } from './sites.js';
import { createRecordingService, type RecordingDependencies } from './recording-service.js';
import { assert, RecordingError, RECORD_LIMITS } from './recording-model.js';
export interface RecordingRequest {method:string;url:string;authorization:string;appCheck:string;contentType:string;range:string;idempotencyKey:string;body:Buffer}
export async function handleRecording(request:RecordingRequest,deps:{auth:MobileAuthDependencies;allowRequest(uid:string):boolean;recording(actor:MobileActor):RecordingDependencies}){
  try{
    assert(request.url.length<=512);const url=new URL(request.url,'https://field.invalid');assert(url.origin==='https://field.invalid'&&!url.search&&!url.hash);
    const route=url.pathname.replace(/^\/v1\/field-app/,'');
    const match=/^\/(visits|uploads)\/([A-Za-z0-9_-]{1,120})(?:\/(photos|chunks|complete|archive))?$/.exec(route);
    const expected=route==='/recording/context'||route==='/recording/storage'?'GET':match?.[1]==='visits'?(match[3]==='photos'||match[3]==='archive'?'POST':!match[3]?'PUT':''):match?.[1]==='uploads'?(match[3]==='chunks'?'PUT':match[3]==='complete'?'POST':!match[3]?'GET':''):'';
    assert(expected,'NOT_FOUND',404);assert(request.method===expected,'METHOD_NOT_ALLOWED',405);
    assert(request.body.length<=(match?.[3]==='chunks'?RECORD_LIMITS.chunk:256*1024),'BODY_TOO_LARGE',413);
    if(expected==='GET')assert(request.body.length===0);else assert((match?.[3]==='chunks'?/^application\/octet-stream(?:;|$)/i:/^application\/json(?:;|$)/i).test(request.contentType));
    const actor=await authorizeMobile(request,deps.auth);assert(deps.allowRequest(actor.uid),'RATE_LIMITED',429);
    if(route==='/recording/context')return{status:200,body:{schemaVersion:2,actor,capabilities:{capture:true,archiveReport:true,sendCustomerReport:false}}};
    const service=createRecordingService(actor.uid,deps.recording(actor));
    if(route==='/recording/storage')return{status:200,body:await service.storageStatus()};
    let input:unknown; if(expected!=='GET'&&match?.[3]!=='chunks'){try{input=JSON.parse(request.body.toString());}catch{throw new RecordingError('REQUEST_INVALID');}}
    const [,group,id,action]=match!;
    assert(group&&id);
    const body=group==='visits'?(action==='photos'?await service.reserve(id,input,request.idempotencyKey):action==='archive'?await service.archive(id,input):await service.save(id,input))
      :action==='chunks'?await service.chunk(id,request.range,request.body):action==='complete'?await service.complete(id,request.idempotencyKey):await service.status(id);
    return{status:200,body};
  }catch(error){
    const code=error instanceof RecordingError||error instanceof MobileAccessError||error instanceof SiteError?error.code:'SERVICE_UNAVAILABLE';
    const status=error instanceof RecordingError?error.status:error instanceof MobileAccessError?(error.code==='MOBILE_AUTH_REQUIRED'?401:error.code==='MOBILE_APP_NOT_REGISTERED'?503:403):error instanceof SiteError?(error.code==='SITE_NOT_FOUND'?404:400):503;
    return{status,body:{error:{code}}};
  }
}
