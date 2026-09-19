import {createPairingService} from './wallboard-pairing.js';

// This class is reachable only through a Worker binding, never a public URL.
// Deployment requires a reviewed SQLite Durable Object binding/migration.
export class WallboardDevices {
 constructor(ctx){
  this.service=createPairingService({repository:{transaction:fn=>ctx.storage.transaction(async tx=>{
   const state=await tx.get('pairing')||{};
   const result=await fn(state);
   await tx.put('pairing',state);
   return result;
  })}});
 }
 async fetch(request){
  const headers={'cache-control':'no-store','content-type':'application/json','x-content-type-options':'nosniff'};
  try{
   if(request.method!=='POST'||new URL(request.url).pathname!=='/command')return Response.json({ok:false,code:'NOT_FOUND'},{status:404,headers});
   const {action,input,identity,token}=await request.json();let result;
   switch(action){
    case 'start':result=await this.service.begin(input?.clientType);break;
    case 'poll':result=await this.service.poll(token);break;
    case 'approve':result=await this.service.approve(input.code,input.name,identity);break;
    case 'revoke':result=await this.service.revoke(input.deviceId,identity);break;
    case 'schedule-update':result=await this.service.scheduleUpdate(input.deviceId,input.targetVersion,identity);break;
    case 'cancel-update':result=await this.service.cancelUpdate(input.deviceId,identity);break;
    case 'list':result=await this.service.list(identity);break;
    case 'publish':result=await this.service.publish(input.snapshot,input.expectedVersion,identity);break;
    case 'display':result=await this.service.readBoard(token,input.clientVersion,{updateStatus:input.updateStatus,updateError:input.updateError});break;
    default:return Response.json({ok:false,code:'NOT_FOUND'},{status:404,headers});
   }
   return Response.json({ok:true,...result},{headers});
  }catch(error){
   const statuses={INVALID_INPUT:400,INVALID_CODE:400,INVALID_TOKEN:401,FORBIDDEN:403,NOT_FOUND:404,RATE_LIMITED:429,DEVICE_LIMIT:409,VERSION_CONFLICT:409};
   const code=Object.hasOwn(statuses,error?.code)?error.code:'WALLBOARD_UNAVAILABLE';
   return Response.json({ok:false,code},{status:statuses[code]||503,headers});
  }
 }
}
