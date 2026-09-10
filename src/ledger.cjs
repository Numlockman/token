'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const C=require('./core.cjs');
class Ledger {
  constructor(file, io=fs) {
    this.file=file;this.io=io;this.s=C.state();this.pending=null;this.config={...C.DEFAULTS};this.warning='';this.failed=false;
    io.mkdirSync(path.dirname(file),{recursive:true});
    if(!io.existsSync(file)) { this.append(C.GENESIS); return; }
    const bytes=io.readFileSync(file);
    // A newline is the record commit marker. Validate the complete prefix before recovery.
    const end=bytes.lastIndexOf(10)+1;
    const lines=bytes.subarray(0,end).toString('utf8').split('\n');lines.pop();
    for(let i=0;i<lines.length;i++) {
      try { C.apply(this.s,JSON.parse(lines[i])); }
      catch(e) { throw new Error(`台帳${i+1}行目が不正です。原本を保持して起動を停止しました: ${e.message}`); }
    }
    if(end<bytes.length) {
      const backup=file+'.interrupted-'+randomUUID()+'.bak';
      io.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);
      const fd=io.openSync(file,'r+');try{io.ftruncateSync(fd,end);io.fsyncSync(fd);}finally{io.closeSync(fd);}
      this.warning=`未完了の末尾を退避して復旧しました。退避先: ${backup}`;
    }
    if(!this.s.blocks.length) this.append(C.GENESIS);
    const last=this.s.blocks.at(-1);if(last.type!=='genesis')this.config=C.settings(last);
  }
  append(b) {
    C.check(!this.failed,'保存エラー後のため、アプリを再起動してください');C.validate(this.s,b);
    const buf=Buffer.from(JSON.stringify(b)+'\n');let fd;
    try {
      fd=this.io.openSync(this.file,'a'); let written=0;
      while(written<buf.length) {const n=this.io.writeSync(fd,buf,written,buf.length-written);C.check(n>0,'書き込みが進みません');written+=n;}
      this.io.fsyncSync(fd);this.io.closeSync(fd);fd=undefined;
    } catch(e) {this.failed=true;if(fd!==undefined)try{this.io.closeSync(fd);}catch{};throw new Error('保存に失敗しました。再起動して台帳を確認してください: '+e.message);}
    C.apply(this.s,b);
  }
  prepare(input) {
    C.check(!this.failed,'再起動が必要です');C.check(!this.pending,'現在の採掘課題を確定または取り消してください');
    const b=C.candidate(this.s,input,this.config);
    this.pending={...b,token:randomUUID()};
    C.register(this.s,b.miner);if(b.type==='transfer'){C.register(this.s,b.from);C.register(this.s,b.to);}
    return this.snapshot();
  }
  submit(input) {
    C.check(this.pending && this.pending.token===input.token,'課題が無効です。画面を更新してください');
    const {token,...base}=this.pending;
    const block={...base,nonce:input.nonce,hash:input.hash};
    this.append(block);this.pending=null;return this.snapshot();
  }
  cancel() {this.pending=null;return this.snapshot();}
  configure(s) {C.check(!this.pending,'設定変更の前に課題を確定または取り消してください');this.config=C.settings(s);return this.snapshot();}
  lookup(value) {
    C.register(this.s,value);
    const history=this.s.blocks.filter(b=>b.from===value||b.to===value||b.miner===value);
    return {id:value,balance:this.s.bank[value],miningCount:history.filter(b=>b.miner===value).length,
      rewards:history.reduce((a,b)=>a+(b.miner===value?b.reward:0),0),
      paidFees:history.reduce((a,b)=>a+(b.from===value?b.fee:0),0),
      receivedFees:history.reduce((a,b)=>a+(b.miner===value?b.fee:0),0),history};
  }
  snapshot() {return {blocks:this.s.blocks.slice(-100).reverse(),count:this.s.blocks.length-1,bank:this.s.bank,config:this.config,pending:this.pending,warning:this.warning,file:this.file,failed:this.failed};}
}
module.exports={Ledger};
