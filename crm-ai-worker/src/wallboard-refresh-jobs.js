import {refreshWallboardFromService} from './wallboard-server-refresh.js';

const headers={'cache-control':'no-store','content-type':'application/json','x-content-type-options':'nosniff'};

// This class has no public route; the scheduled Worker invokes it through a binding.
export class WallboardRefreshJobs {
 constructor(_ctx,env,refresh=refreshWallboardFromService){this.env=env;this.refresh=refresh;}
 async fetch(request){
  if(request.method!=='POST'||new URL(request.url).pathname!=='/refresh')return Response.json({ok:false,code:'NOT_FOUND'},{status:404,headers});
  if(this.env?.WALLBOARD_SCHEDULED_REFRESH_ENABLED!=='true')return Response.json({ok:false,code:'WALLBOARD_UNAVAILABLE'},{status:503,headers});
  try{
   await this.refresh({env:this.env,trace:stage=>console.info('wallboard-cron-stage',stage)});
   return Response.json({ok:true},{headers});
  }catch{
   return Response.json({ok:false,code:'WALLBOARD_UNAVAILABLE'},{status:503,headers});
  }
 }
}
