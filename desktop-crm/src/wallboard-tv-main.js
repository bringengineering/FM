// Separate read-only application entry. No CRM preload, staff session or editing IPC.
const {app,BrowserWindow,ipcMain,safeStorage,net}=require('electron');
const path=require('node:path');
const {createWindowsVault}=require('./wallboard-vault');
const {createTvClient}=require('./wallboard-tv-client');
app.setName('BRING TV');app.setPath('userData',path.join(app.getPath('appData'),'BRING-TV'));
const endpoint='https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/wallboard/';
let window;
app.whenReady().then(async()=>{
 const credential=path.join(app.getPath('userData'),'device.bin');
 const vault=createWindowsVault({credential,safeStorage});
 const client=createTvClient({vault,clientVersion:app.getVersion(),request:async(action,token,input={})=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{const response=await net.fetch(endpoint+action,{method:'POST',redirect:'error',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(input),signal:controller.signal});const data=await response.json();if(!response.ok||data.ok!==true)throw Object.assign(new Error('TV 서버 연결을 확인해 주세요.'),{code:data.code});return data;}finally{clearTimeout(timer);}
 }});
 window=new BrowserWindow({width:1280,height:720,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'wallboard-tv-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
 window.webContents.session.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
 const handle=(channel,fn)=>ipcMain.handle(channel,(event)=>{if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('접근할 수 없습니다.');return fn();});
 handle('tv:start',()=>client.start());handle('tv:poll',()=>client.poll());handle('tv:display',()=>client.display());
 handle('tv:fullscreen',()=>window.setFullScreen(!window.isFullScreen()));
 await window.loadFile(path.join(__dirname,'wallboard-tv.html'));
});
app.on('window-all-closed',()=>app.quit());
