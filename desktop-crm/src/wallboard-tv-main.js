// Separate read-only application entry. No CRM preload, staff session or editing IPC.
const {app,BrowserWindow,ipcMain,safeStorage,net}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const {createTvClient}=require('./wallboard-tv-client');
app.setName('BRING TV');app.setPath('userData',path.join(app.getPath('appData'),'BRING-TV'));
const endpoint='https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/wallboard/';
let window;
app.whenReady().then(async()=>{
 const credential=path.join(app.getPath('userData'),'device.bin');
 const protectedStorage=()=>{if(process.platform!=='win32'||!safeStorage.isEncryptionAvailable())throw new Error('Windows 보호 저장소를 사용할 수 없습니다.');};
 const vault={
  async read(){protectedStorage();try{return safeStorage.decryptString(await fs.readFile(credential));}catch(error){if(error.code==='ENOENT')return null;throw new Error('기기 인증 정보를 읽을 수 없습니다.');}},
  async write(token){protectedStorage();await fs.mkdir(path.dirname(credential),{recursive:true});await fs.writeFile(credential+'.tmp',safeStorage.encryptString(token),{mode:0o600});await fs.rename(credential+'.tmp',credential);},
  async clear(){await fs.rm(credential,{force:true});}
 };
 const client=createTvClient({vault,request:async(action,token)=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{const response=await net.fetch(endpoint+action,{method:'POST',redirect:'error',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:'{}',signal:controller.signal});const data=await response.json();if(!response.ok||data.ok!==true)throw Object.assign(new Error('TV 서버 연결을 확인해 주세요.'),{code:data.code});return data;}finally{clearTimeout(timer);}
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
