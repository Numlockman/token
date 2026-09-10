'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const C=require('./core.cjs');
class Ledger {
  constructor(file, io=fs) {
    this.file=file;this.io=io;this.s=C.state();this.pending=[];this.round=null;this.requests=[];this.requestSequence=0;this.config={...C.DEFAULTS};this.warning='';this.failed=false;
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
    const last=this.s.blocks.at(-1);if(last.type!=='genesis')this.config=last.version===1?{...C.DEFAULTS,reward:last.reward}:C.settings(last);
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
  ensureWritable() {C.check(!this.failed,'保存エラー後のため、アプリを再起動してください');}
  addRequest(input) {
    this.ensureWritable();
    const from=C.id(input.from),to=C.id(input.to),amount=C.units(input.amount);
    C.check(amount>0 && amount<=999,'送金額は0.1〜99.9 Coinにしてください');
    C.check((this.s.bank[from]||0)>=amount+2,'残高不足です（手数料0.2 Coinを含む）');
    C.register(this.s,from);C.register(this.s,to);
    this.requests.push({id:randomUUID(),number:++this.requestSequence,from,to,amount});
    return this.snapshot();
  }
  removeRequest(requestId) {
    this.ensureWritable();
    C.check(this.round?.requestId!==requestId,'採掘中の依頼は削除できません。先にラウンドを取り消してください');
    C.check(this.requests.some(r=>r.id===requestId),'依頼が見つかりません');
    this.requests=this.requests.filter(r=>r.id!==requestId);return this.snapshot();
  }
  prepare(input) {
    this.ensureWritable();C.id(input.miner);
    const requestId=input.requestId??null;
    C.check(this.pending.length<3,'同時に発行できる問題は3人分までです');
    C.check(!this.pending.some(b=>b.miner===input.miner),'同じ採掘者IDには発行済みです');
    if(this.round) C.check(this.round.requestId===requestId,'別の取引は同時に採掘できません。現在のラウンドを完了してください');
    const request=requestId===null?null:this.requests.find(r=>r.id===requestId);
    C.check(requestId===null || request,'依頼が見つかりません');
    const b=C.candidate(this.s,request?{type:'transfer',from:request.from,to:request.to,amount:C.coin(request.amount),miner:input.miner}:{type:'reward',miner:input.miner},this.config);
    if(this.round) {
      const first=this.pending[0];
      for(const key of ['version','index','type','from','to','amount','fee','prevHash','reward','successDenominator'])
        C.check(b[key]===first[key],'現在のラウンドと条件が異なります');
    } else this.round={id:randomUUID(),requestId};
    this.pending.push({...b,token:randomUUID()});C.register(this.s,b.miner);
    return this.snapshot();
  }
  submit(input) {
    this.ensureWritable();
    const task=this.pending.find(b=>b.token===input.token);
    C.check(task,'この問題は無効です。ほかの採掘者が確定したか、取り消されています');
    const {token,...base}=task;
    const block={...base,nonce:input.nonce,hash:input.hash};
    this.append(block); // Only successful durable append can consume a request or end a round.
    if(this.round.requestId!==null) this.requests=this.requests.filter(r=>r.id!==this.round.requestId);
    this.pending=[];this.round=null;return this.snapshot();
  }
  cancel() {this.ensureWritable();this.pending=[];this.round=null;return this.snapshot();}
  configure(s) {this.ensureWritable();C.check(!this.round,'設定変更の前にラウンドを確定または取り消してください');this.config=C.settings(s);return this.snapshot();}
  lookup(value) {
    C.register(this.s,value);
    const history=this.s.blocks.filter(b=>b.from===value||b.to===value||b.miner===value);
    return {id:value,balance:this.s.bank[value],miningCount:history.filter(b=>b.miner===value).length,
      rewards:history.reduce((a,b)=>a+(b.miner===value?b.reward:0),0),
      paidFees:history.reduce((a,b)=>a+(b.from===value?b.fee:0),0),
      receivedFees:history.reduce((a,b)=>a+(b.miner===value?b.fee:0),0),history};
  }
  snapshot() {return {blocks:this.s.blocks.slice(-100).reverse(),count:this.s.blocks.length-1,bank:this.s.bank,config:this.config,pending:this.pending,round:this.round,requests:this.requests.map(r=>({...r,active:this.round?.requestId===r.id,affordable:(this.s.bank[r.from]||0)>=r.amount+2})),warning:this.warning,file:this.file,failed:this.failed};}
}
module.exports={Ledger};
