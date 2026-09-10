'use strict';
const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {Ledger}=require('./ledger.cjs');
let ledger,win;
if(!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
  app.whenReady().then(()=>{
    try { ledger=new Ledger(path.join(app.getPath('userData'),'data','blockchain.jsonl')); }
    catch(e) {dialog.showErrorBox('台帳を復旧できません',e.message);app.quit();return;}
    ipcMain.handle('mining',async(event,action,args)=>{
      try {
        if(event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame)throw new Error('操作元が不正です');
        let data;
        switch(action){
          case 'state':data=ledger.snapshot();break;
          case 'prepare':data=ledger.prepare(args);break;
          case 'submit':data=ledger.submit(args);break;
          case 'cancel':data=ledger.cancel();break;
          case 'settings':data=ledger.configure(args);break;
          case 'lookup':data=ledger.lookup(args);break;
          case 'folder':shell.showItemInFolder(ledger.file);data=true;break;
          case 'backup': {
            const result=await dialog.showSaveDialog(win,{defaultPath:'blockchain-backup.jsonl'});
            if(!result.canceled){
              if(path.resolve(result.filePath)===path.resolve(ledger.file))throw new Error('台帳自身をバックアップ先にはできません');
              fs.copyFileSync(ledger.file,result.filePath);
            }
            data=!result.canceled;break;
          }
          default:throw new Error('不明な操作です');
        }
        return {ok:true,data};
      }catch(e){return {ok:false,error:e.message};}
    });
    win=new BrowserWindow({width:1180,height:900,minWidth:760,minHeight:600,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',e=>e.preventDefault());
    win.setMenuBarVisibility(false);win.loadFile(path.join(__dirname,'index.html'));
  });
  app.on('window-all-closed',()=>app.quit());
}
