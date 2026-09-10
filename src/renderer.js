'use strict';
const $=id=>document.getElementById(id);const coin=n=>(n/10).toFixed(1);let snapshot;
async function call(action,args){if(!window.mining)throw Error('この画面はElectronアプリで起動してください。READMEをご覧ください。');const r=await window.mining.call(action,args);if(!r.ok)throw Error(r.error);return r.data;}
function render(s){snapshot=s;$('count').textContent=`確定 ${s.count} ブロック`;$('warning').textContent=s.warning;$('filepath').textContent=s.file;
$('settings').elements.successDenominator.value=s.config.successDenominator;$('settings').elements.reward.value=coin(s.config.reward);
$('empty').hidden=!!s.pending;$('task').hidden=!s.pending;
$('prepare').querySelector('button').disabled=!!s.pending||s.failed;
if(s.pending){const b=s.pending;const data=b.from+b.to+String(b.amount).padStart(6,'0')+b.prevHash+'????';$('digits').textContent=data.match(/.{5}/g).join(' ');$('taskinfo').textContent=`課題 #${b.index} / 採掘者 ${b.miner} / ${b.type==='reward'?'採掘のみ':b.from+' → '+b.to+' / '+coin(b.amount)+' Coin'}`;$('condition').textContent=`成功条件: Hash < ${b.difficulty} ｜成功率: ${(b.successCount/100).toFixed(2)}%（${b.successCount}/10000通り、目標1/${b.successDenominator}） ｜受取: 報酬 ${coin(b.reward)} + 手数料 ${coin(b.fee)} Coin`;}
$('blocks').replaceChildren();for(const b of s.blocks){const row=document.createElement('tr');const cells=b.type==='genesis'?[0,'Genesis','—','—','—','—','—','0000 → 0000']:[b.index,b.type==='reward'?'採掘':'送金',b.from+' → '+b.to,coin(b.amount),b.miner,coin(b.reward)+' / '+coin(b.fee),b.nonce,b.prevHash+' → '+b.hash];for(const value of cells){const td=document.createElement('td');td.textContent=value;row.append(td);}$('blocks').append(row);}}
async function act(fn){try{await fn();}catch(e){$('notice').textContent=e.message;}}
for(const name of ['prepare','submit','settings','lookup'])$(name).addEventListener('submit',event=>{event.preventDefault();act(async()=>{const f=Object.fromEntries(new FormData(event.target));if(name==='lookup'){const a=await call(name,f.id);$('account').textContent=`ID: ${a.id}\n残高: ${coin(a.balance)} Coin\n採掘回数: ${a.miningCount}\n採掘報酬: ${coin(a.rewards)} Coin\n支払手数料: ${coin(a.paidFees)} / 受取手数料: ${coin(a.receivedFees)} Coin`;$('history').textContent=a.history.slice(-20).reverse().map(b=>`#${b.index} ${b.from} → ${b.to} / ${coin(b.amount)} Coin / 採掘者 ${b.miner}`).join(' ｜ ');return;}
if(name==='submit')f.token=snapshot.pending?.token;
if(name==='settings'){f.successDenominator=Number(f.successDenominator);f.reward=Math.round(Number(f.reward)*10);}
render(await call(name,f));$('notice').textContent=name==='submit'?'採掘成功。台帳への保存が完了しました。':name==='prepare'?'課題を発行しました。紙に写すか印刷してください。':'設定を更新しました。';if(name==='submit')$('submit').reset();});});
$('prepare').elements.type.addEventListener('change',event=>{$('transfer').hidden=event.target.value!=='transfer';});
$('cancel').onclick=()=>act(async()=>{if(confirm('この課題を取り消しますか？ 配布済みの課題も無効になります。')){render(await call('cancel'));$('notice').textContent='課題を取り消しました。';}});
$('print').onclick=()=>window.print();$('folder').onclick=()=>act(()=>call('folder'));$('backup').onclick=()=>act(async()=>{$('notice').textContent=await call('backup')?'バックアップを保存しました。':'バックアップを中止しました。';});act(async()=>render(await call('state')));
