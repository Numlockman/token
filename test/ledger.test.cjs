const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const C=require('../src/core.cjs');const {Ledger}=require('../src/ledger.cjs');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'human-mining-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'blockchain.jsonl');}
const alice='00100001',bob='00100002',miner='00100003';
function solve(l,index=0){const b=l.pending[index];for(let n=0;n<10000;n++){const nonce=String(n).padStart(4,'0'),hash=C.hash(C.payload(b,nonce),b.version);if(Number(hash)<b.difficulty)return {token:b.token,nonce,hash};}throw Error('no solution');}
function prepareTransfer(l,input){l.addRequest(input);return l.prepare({miner:input.miner,requestId:l.requests.at(-1).id});}
function mine(l,who=alice){l.prepare({type:'reward',miner:who});l.submit(solve(l));}
test('35桁・手計算の既知値・金額とIDの検証',()=>{assert.equal(C.hash('00347'+'00052'+'00000'.repeat(5)),'1514');assert.equal(C.hash('00000'.repeat(6)+'00001'),'0011');assert.equal(C.hash('01234'+'00000'.repeat(5),1),'5227');assert.equal(C.units('12.4'),124);for(const x of ['-1','1.22','NaN','100000'])assert.throws(()=>C.units(x));assert.throws(()=>C.id('00000000'));assert.throws(()=>C.id(12345678));});
test('新規発行→送金→再起動で全残高復元',t=>{const file=setup(t),l=new Ledger(file);mine(l);mine(l);prepareTransfer(l,{type:'transfer',from:alice,to:bob,amount:'1.5',miner});assert.equal(C.payload(l.pending[0],'0000').length,35);l.submit(solve(l));assert.equal(l.s.bank[alice],3);assert.equal(l.s.bank[bob],15);assert.equal(l.s.bank[miner],12);assert.deepEqual(new Ledger(file).s,l.s);assert.equal(Object.values(l.s.bank).reduce((a,b)=>a+b,0),30);});
test('残高不足・誤答・古い課題・二重確定を拒否',t=>{const l=new Ledger(setup(t));assert.throws(()=>prepareTransfer(l,{type:'transfer',from:alice,to:bob,amount:'1',miner}));l.prepare({type:'reward',miner:alice});const good=solve(l);assert.throws(()=>l.submit({...good,hash:'xxxx'}));assert.equal(l.s.blocks.length,1);l.submit(good);assert.throws(()=>l.submit(good));l.prepare({type:'reward',miner});assert.throws(()=>l.submit(good));});
test('同じIDが送受信・採掘を兼ねても正しく精算',t=>{const l=new Ledger(setup(t));mine(l);prepareTransfer(l,{type:'transfer',from:alice,to:alice,amount:'0.8',miner:alice});l.submit(solve(l));assert.equal(l.s.bank[alice],20);});
test('設定は課題中固定・過去の報酬を変更しない',t=>{const file=setup(t),l=new Ledger(file);mine(l);l.configure({successDenominator:4,reward:25});l.prepare({type:'reward',miner:alice});assert.throws(()=>l.configure(C.DEFAULTS));l.submit(solve(l));const restarted=new Ledger(file);assert.equal(restarted.s.bank[alice],35);assert.equal(restarted.config.reward,25);});
test('未完了末尾をバックアップして復旧、次の追記も正常',t=>{const file=setup(t),l=new Ledger(file);mine(l);const valid=fs.readFileSync(file);fs.appendFileSync(file,'{"index":2');const restored=new Ledger(file);assert.match(restored.warning,/復旧/);assert.deepEqual(fs.readFileSync(file),valid);assert.equal(fs.readdirSync(path.dirname(file)).filter(f=>f.endsWith('.bak')).length,1);mine(restored,bob);assert.equal(new Ledger(file).s.blocks.length,3);});
test('末尾改行のない完全JSONも未確定として退避',t=>{const file=setup(t),l=new Ledger(file);mine(l);const bytes=fs.readFileSync(file);fs.writeFileSync(file,bytes.subarray(0,-1));assert.equal(new Ledger(file).s.blocks.length,1);});
test('台帳途中の破損は原本を変更せず停止',t=>{const file=setup(t),l=new Ledger(file);mine(l);const lines=fs.readFileSync(file,'utf8').trim().split('\n');const b=JSON.parse(lines[1]);b.hash='xxxx';lines[1]=JSON.stringify(b);fs.writeFileSync(file,lines.join('\n')+'\nunfinished');const before=fs.readFileSync(file);assert.throws(()=>new Ledger(file),/2行目/);assert.deepEqual(fs.readFileSync(file),before);});
test('fsync失敗時はbank更新せず、そのセッションの追記を停止',t=>{const file=setup(t),l=new Ledger(file);l.prepare({type:'reward',miner:alice});const good=solve(l);l.io={...fs,fsyncSync(){throw Error('injected');}};assert.throws(()=>l.submit(good),/保存に失敗/);assert.equal(l.s.bank[alice],0);assert.equal(l.s.blocks.length,1);assert.throws(()=>l.submit(good),/再起動/);assert.equal(new Ledger(file).s.bank[alice],10);});
test('部分書き込みを繰り返して完全な1行を保存',t=>{const file=setup(t),l=new Ledger(file);l.io={...fs,writeSync(fd,b,offset,length){return fs.writeSync(fd,b,offset,Math.min(length,7));}};mine(l);assert.equal(new Ledger(file).s.bank[alice],10);});
test('100回の採掘で整数残高・連鎖・保存を確認',t=>{const file=setup(t),l=new Ledger(file);for(let i=0;i<100;i++)mine(l,i%2?alice:bob);const r=new Ledger(file);assert.equal(r.s.bank[alice],500);assert.equal(r.s.bank[bob],500);});
test('複数課題の全Nonceを独立計算し1/3・1/4の最適ターゲットを確認',()=>{
  for(const denominator of [3,4])for(const prevHash of ['0000','4321','9999']) {
    const b={version:3,miner,from:alice,to:bob,amount:123,prevHash};const result=C.calibrate(b,denominator);
    const histogram=Array(10000).fill(0);let count=0;
    for(let n=0;n<10000;n++) {
      const chunks=C.payload(b,String(n).padStart(4,'0')).match(/.{5}/g).map(Number);
      const [aa,bb,cc,dd,ee,ff,gg]=chunks.map(n=>Math.floor(n/1000)+n%1000), x=(aa+cc+ee+gg)%1000, y=(bb+dd+ff+gg)%90+10;
      assert.ok(x>=0&&x<=999&&y>=10&&y<=99);
      const h=x*y%10000;histogram[h]++;if(h<result.difficulty)count++;
    }
    assert.equal(result.successCount,count);assert.ok(Math.abs(count/10000-1/denominator)<0.005);
    let cumulative=0;for(let t=1;t<=10000;t++){cumulative+=histogram[t-1];assert.ok(Math.abs(count*denominator-10000)<=Math.abs(cumulative*denominator-10000));}
  }
});
test('ターゲット境界以上を拒否し、内部の正解一覧は課題に含めない',t=>{
  const l=new Ledger(setup(t));l.prepare({type:'reward',miner:alice});const b=l.pending[0];
  for(let n=0;n<10000;n++){const nonce=String(n).padStart(4,'0'),hash=C.hash(C.payload(b,nonce),b.version);if(Number(hash)>=b.difficulty){assert.throws(()=>l.submit({token:b.token,nonce,hash}),/判定上限/);break;}}
  assert.equal(b.nonce,undefined);assert.equal(b.hash,undefined);assert.equal(b.answers,undefined);
  const good=solve(l),original=b.difficulty;b.difficulty=10000;assert.throws(()=>l.submit(good),/自動ターゲット/);b.difficulty=original;l.submit(good);
});
test('旧台帳を保持して新方式へ移行、混在台帳を再起動で復元',t=>{
  const file=setup(t);const old={version:1,index:1,type:'reward',from:C.ZERO,to:alice,amount:0,fee:0,miner:alice,difficulty:10000,reward:17,prevHash:'0000',nonce:'0000'};
  old.hash=C.hash(C.payload(old),1);const prefix=JSON.stringify(C.GENESIS)+'\n'+JSON.stringify(old)+'\n';fs.writeFileSync(file,prefix);
  const l=new Ledger(file);assert.equal(l.config.successDenominator,3);assert.equal(l.config.reward,17);mine(l);
  assert.ok(fs.readFileSync(file,'utf8').startsWith(prefix));const restored=new Ledger(file);assert.equal(restored.s.bank[alice],34);assert.deepEqual(restored.s.blocks.map(b=>b.version),[1,1,3]);
});
test('35桁の位置・先頭ゼロ・Nonce位置を正確に保持',()=>{
  const b={version:3,miner:'01234567',from:'02345678',amount:12,to:'03456789',prevHash:'0042'};
  const data=C.payload(b,'0056');assert.equal(data,'01234567'+'0056'+'02345678'+'012'+'03456789'+'0042');
  assert.equal(data.length,35);assert.equal(data.slice(8,12),'0056');assert.equal(data.slice(20,23),'012');
  assert.throws(()=>C.hash('0'.repeat(30),3));assert.throws(()=>C.hash(data,2));
});
test('採掘のみの3人競争は採掘者ID以外同一、先着1人だけ発行',t=>{
  for(const winnerIndex of [0,1,2]){
    const file=path.join(path.dirname(setup(t)),String(winnerIndex),'blockchain.jsonl'),l=new Ledger(file);
    for(const who of [alice,bob,miner])l.prepare({miner:who});
    const data=l.pending.map(b=>C.payload(b,'1234'));
    assert.ok(data.every(x=>x.slice(8)===data[0].slice(8)));assert.equal(data[0].slice(12,20),C.ZERO);assert.equal(data[0].slice(23,31),C.ZERO);
    const submissions=l.pending.map((_,i)=>solve(l,i));l.submit(submissions[winnerIndex]);
    assert.equal(l.pending.length,0);assert.equal(l.round,null);assert.equal(l.s.bank[[alice,bob,miner][winnerIndex]],10);
    for(const answer of submissions)assert.throws(()=>l.submit(answer),/無効/);
    assert.equal(Object.values(l.s.bank).reduce((a,b)=>a+b,0),10);assert.equal(new Ledger(file).s.blocks.length,2);
  }
});
test('付箋送金の3人競争で送金・手数料・報酬を1回だけ確定',t=>{
  const file=setup(t),l=new Ledger(file);mine(l);mine(l);
  l.addRequest({from:alice,to:bob,amount:'1.0'});const id=l.requests[0].id;const before=JSON.stringify(l.s.bank);
  assert.equal(l.requests.length,1);assert.equal(l.s.bank[alice],20);
  for(const who of [alice,bob,miner])l.prepare({requestId:id,miner:who});
  assert.equal(JSON.stringify({...l.s.bank, [miner]:undefined}),JSON.stringify({...JSON.parse(before),[miner]:undefined}));
  const tails=l.pending.map(b=>C.payload(b,'0000').slice(8));assert.ok(tails.every(x=>x===tails[0]));
  assert.equal(l.snapshot().requests[0].active,true);const loser=solve(l,0);l.submit(solve(l,2));assert.throws(()=>l.submit(loser));
  assert.equal(l.s.bank[alice],8);assert.equal(l.s.bank[bob],10);assert.equal(l.s.bank[miner],12);assert.equal(l.requests.length,0);
  assert.deepEqual(new Ledger(file).s,l.s);
});
test('4人目・同一ID・別取引・取引と採掘のみの混在を拒否',t=>{
  const l=new Ledger(setup(t));mine(l);l.addRequest({from:alice,to:bob,amount:'0.2'});l.addRequest({from:alice,to:miner,amount:'0.2'});
  const [first,second]=l.requests;l.prepare({requestId:first.id,miner:alice});
  assert.throws(()=>l.prepare({requestId:first.id,miner:alice}),/同じ採掘者/);
  assert.throws(()=>l.prepare({requestId:second.id,miner:bob}),/別の取引/);
  assert.throws(()=>l.prepare({miner:bob}),/別の取引/);
  for(const who of [bob,miner])l.prepare({requestId:first.id,miner:who});
  assert.throws(()=>l.prepare({requestId:first.id,miner:'00100004'}),/3人/);assert.equal(l.pending.length,3);
});
test('取消は依頼を保持し古い回答を失効、採掘中の付箋削除を拒否',t=>{
  const l=new Ledger(setup(t));mine(l);l.addRequest({from:alice,to:bob,amount:'0.2'});const id=l.requests[0].id;
  l.prepare({miner,requestId:id});const answer=solve(l);assert.throws(()=>l.removeRequest(id),/採掘中/);
  l.cancel();assert.equal(l.requests.length,1);assert.equal(l.snapshot().requests[0].active,false);
  l.prepare({miner,requestId:id});assert.throws(()=>l.submit(answer),/無効/);l.cancel();l.removeRequest(id);
  assert.equal(l.requests.length,0);assert.throws(()=>l.prepare({miner,requestId:id}),/見つかりません/);
});
test('金額3桁の上限、待ち依頼の残高再検証、再起動で未確定を破棄',t=>{
  const file=setup(t),l=new Ledger(file);l.configure({successDenominator:3,reward:1001});mine(l);
  l.addRequest({from:alice,to:bob,amount:'99.9'});const first=l.requests[0].id;
  assert.throws(()=>l.addRequest({from:alice,to:bob,amount:'100.0'}),/99.9/);
  l.addRequest({from:alice,to:miner,amount:'0.1'});const second=l.requests[1].id;
  l.prepare({requestId:first,miner:bob});l.submit(solve(l));assert.equal(l.s.bank[alice],0);
  assert.equal(l.snapshot().requests[0].affordable,false);assert.throws(()=>l.prepare({requestId:second,miner}),/残高不足/);
  const restored=new Ledger(file);assert.equal(restored.requests.length,0);assert.equal(restored.pending.length,0);assert.equal(restored.round,null);
});
test('保存失敗時は3人の競争と付箋を確定扱いにせず停止',t=>{
  const l=new Ledger(setup(t));mine(l);l.addRequest({from:alice,to:bob,amount:'0.5'});const id=l.requests[0].id;
  for(const who of [alice,bob,miner])l.prepare({requestId:id,miner:who});
  l.io={...fs,writeSync(){throw Error('disk full');}};const before=JSON.stringify(l.s.bank);
  assert.throws(()=>l.submit(solve(l,1)),/保存に失敗/);assert.equal(l.pending.length,3);assert.equal(l.requests.length,1);assert.equal(JSON.stringify(l.s.bank),before);
  assert.throws(()=>l.cancel(),/再起動/);assert.throws(()=>l.submit(solve(l,2)),/再起動/);
});
test('v1→v2→v3の混在台帳を復元し、v2への逆戻りを拒否',t=>{
  const file=setup(t);const one={version:1,index:1,type:'reward',from:C.ZERO,to:alice,amount:0,fee:0,miner:alice,difficulty:10000,reward:10,prevHash:'0000',nonce:'0000'};one.hash=C.hash(C.payload(one),1);
  const two={version:2,index:2,type:'reward',from:C.ZERO,to:bob,amount:0,fee:0,miner:bob,reward:10,successDenominator:4,prevHash:one.hash};Object.assign(two,C.calibrate(two,4));
  for(let n=0;n<10000;n++){two.nonce=String(n).padStart(4,'0');two.hash=C.hash(C.payload(two),2);if(Number(two.hash)<two.difficulty)break;}
  const prefix=[C.GENESIS,one,two].map(b=>JSON.stringify(b)+'\n').join('');fs.writeFileSync(file,prefix);
  const l=new Ledger(file);assert.equal(l.config.successDenominator,4);mine(l,miner);const restored=new Ledger(file);
  assert.deepEqual(restored.s.blocks.map(b=>b.version),[1,1,2,3]);assert.equal(restored.s.bank[miner],10);assert.ok(fs.readFileSync(file,'utf8').startsWith(prefix));
  assert.throws(()=>C.validate(restored.s,{...two,index:4,prevHash:restored.s.blocks.at(-1).hash}),/巻き戻し/);
});
