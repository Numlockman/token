const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('mining',{call:(action,args)=>ipcRenderer.invoke('mining',action,args)});
