import {refreshWallboardFromFirebase,refreshWallboardFromService} from './wallboard-server-refresh.js';

const headers={'cache-control':'no-store','content-type':'application/json','x-content-type-options':'nosniff'};

// This class has no public route; the scheduled Worker invokes it through a binding.
export class WallboardRefreshJobs {
 constructor(_ctx,env,refresh=refreshWallboardFromService,refreshUser=refreshWallboardFromFirebase){this.env=env;this.refresh=refresh;this.refreshUser=refreshUser;}
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(request.method!=='POST'||!['/refresh','/refresh-user'].includes(path))return Response.json({ok:false,code:'NOT_FOUND'},{status:404,headers});
  if(path==='/refresh'&&this.env?.WALLBOARD_SCHEDULED_REFRESH_ENABLED!=='true')return Response.json({ok:false,code:'WALLBOARD_UNAVAILABLE'},{status:503,headers});
  try{
   if(path==='/refresh'){
    await this.refresh({env:this.env,trace:stage=>console.info('wallboard-cron-stage',stage)});
    return Response.json({ok:true},{headers});
   }
   const input=await request.json();
   if(!input||typeof input.idToken!=='string'||!input.idToken||!input.identity?.uid||input.identity.emailVerified!==true)return Response.json({ok:false,code:'FORBIDDEN'},{status:403,headers});
   const result=await this.refreshUser({idToken:input.idToken,identity:input.identity,env:this.env});
   const {version,publishedAt,sourceReadAt,reconciledAt}=result;
   return Response.json({ok:true,version,publishedAt,sourceReadAt,reconciledAt},{headers});
  }catch(error){
   const forbidden=error?.code==='FORBIDDEN';
   return Response.json({ok:false,code:forbidden?'FORBIDDEN':'WALLBOARD_UNAVAILABLE'},{status:forbidden?403:503,headers});
  }
 }
}
