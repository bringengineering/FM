const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('bringTV',{
 start:()=>ipcRenderer.invoke('tv:start'),poll:()=>ipcRenderer.invoke('tv:poll'),display:()=>ipcRenderer.invoke('tv:display'),fullscreen:()=>ipcRenderer.invoke('tv:fullscreen')
});
