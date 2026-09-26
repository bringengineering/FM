'use strict';
const validVersion=value=>typeof value==='string'&&/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value);
function createTvUpdateController({updater,currentVersion,resolveChannel,schedule=setTimeout,cancelSchedule=clearTimeout}){
 if(!updater||typeof updater.on!=='function'||typeof resolveChannel!=='function'||!validVersion(currentVersion))throw new TypeError('TV updater configuration required');
 updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowPrerelease=false;
 let state={status:'idle',error:''},target='',busy=false,timer=null,closed=false;
 const snapshot=()=>({status:state.status,error:state.error});
 const fail=code=>{state={status:'failed',error:code};busy=false;return snapshot();};
 const downloaded=info=>{
  if(closed||!target)return;
  if(info?.version!==target){fail('TARGET_MISMATCH');return;}
  state={status:'ready',error:''};
  timer=schedule(()=>{timer=null;if(closed)return;state={status:'installing',error:''};updater.quitAndInstall(false,true);},3000);
 };
 const errored=()=>{if(!closed)fail('DOWNLOAD_FAILED');};
 updater.on('update-downloaded',downloaded);updater.on('error',errored);
 return {
  report:snapshot,
  async accept(command){
   const requested=command?.targetVersion;if(!validVersion(requested))return fail('INVALID_COMMAND');
   if(requested===currentVersion){target='';busy=false;state={status:'installed',error:''};return snapshot();}
   if(busy||['ready','installing'].includes(state.status))return snapshot();
   busy=true;target=requested;state={status:'downloading',error:''};
   try{
    const channel=await resolveChannel();
    if(channel?.version!==target||typeof channel.feedUrl!=='string'||!channel.feedUrl.startsWith('https://github.com/bringengineering/FM/releases/download/tv-v'))return fail('TARGET_MISMATCH');
    updater.setFeedURL({provider:'generic',url:channel.feedUrl});await updater.checkForUpdates();await updater.downloadUpdate();return snapshot();
   }catch(error){return fail(error?.code&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'DOWNLOAD_FAILED');}
  },
  dispose(){closed=true;if(timer!==null)cancelSchedule(timer);timer=null;updater.removeListener('update-downloaded',downloaded);updater.removeListener('error',errored);}
 };
}
module.exports={createTvUpdateController};
