'use strict';
const $=id=>document.getElementById(id),coin=n=>(n/10).toFixed(1);
let snapshot=null,selectedRequest=null,busy=false;
async function call(action,args){if(!window.mining)throw Error('Electronアプリで起動してください。READMEをご覧ください。');const r=await window.mining.call(action,args);if(!r.ok)throw Error(r.error);return r.data;}
function describe(r){return r?`${r.from} → ${r.to} / ${coin(r.amount)} Coin（手数料0.2）`:'採掘のみ（送金なし）';}
function render(s){
  const drafts=new Map([...document.querySelectorAll('.task')].map(card=>[card.dataset.token,{nonce:card.querySelector('[name=nonce]').value,hash:card.querySelector('[name=hash]').value}]));
  snapshot=s;
  if(s.round)selectedRequest=s.round.requestId;
  else if(selectedRequest&&!s.requests.some(r=>r.id===selectedRequest))selectedRequest=null;
  $('count').textContent=`確定 ${s.count} ブロック`;$('warning').textContent=s.warning;$('filepath').textContent=s.file;
  $('settings').elements.successDenominator.value=s.config.successDenominator;$('settings').elements.reward.value=coin(s.config.reward);
  $('settings').querySelectorAll('input,select,button').forEach(e=>e.disabled=!!s.round||s.failed);
  const selected=s.requests.find(r=>r.id===selectedRequest);
  $('selection').textContent=(selected?`依頼 #${selected.number}：`:'')+describe(selected);
  $('reward').disabled=!!s.round||s.failed;
  $('issue-button').disabled=s.pending.length>=3||s.failed||!!(selected&&!selected.affordable);
  $('issue-button').textContent=s.round?'同じ条件で参加者を追加':'問題を発行';
  $('round-status').textContent=s.round?`ラウンド進行中：${s.pending.length} / 3人。採掘者IDを変えて追加できます。`:'送金依頼を選ぶか、採掘のみで始められます。';
  $('request').querySelector('button').disabled=s.failed;
  $('board').replaceChildren();
  if(!s.requests.length){const p=document.createElement('p');p.textContent='送金依頼はまだありません。左の「送金依頼を掲示する」から追加できます。';$('board').append(p);}
  for(const r of s.requests){
    const note=document.createElement('article');note.className='sticky'+(r.id===selectedRequest?' selected':'');
    const select=document.createElement('button');select.type='button';select.className='note-select';select.dataset.request=r.id;
    select.disabled=s.failed||!!(s.round&&!r.active)||!r.affordable;select.setAttribute('aria-pressed',String(r.id===selectedRequest));
    const title=document.createElement('strong');title.textContent=`依頼 #${r.number}`;
    const detail=document.createElement('span');detail.textContent=`${r.from}\n↓\n${r.to}\n${coin(r.amount)} Coin`;
    const status=document.createElement('small');status.textContent=r.active?'採掘中':!r.affordable?'残高不足・選択不可':r.id===selectedRequest?'選択中':'クリックして選択';select.append(title,detail,status);
    const remove=document.createElement('button');remove.type='button';remove.className='note-remove';remove.dataset.remove=r.id;remove.textContent='依頼を取り下げる';remove.disabled=r.active||s.failed;
    note.append(select,remove);$('board').append(note);
  }
  $('empty').hidden=s.pending.length>0;$('slots').textContent=`${s.pending.length} / 3人`;$('cancel').hidden=!s.round;$('cancel').disabled=s.failed;
  $('tasks').replaceChildren();
  for(const [i,b] of s.pending.entries()){
    const card=$('task-template').content.firstElementChild.cloneNode(true);card.dataset.token=b.token;
    const set=(selector,value)=>card.querySelector(selector).textContent=value;
    set('.task-number',`ブロック #${b.index} / 問題 ${i+1} / 識別番号 ${b.token}`);
    set('.task-miner',`採掘者 ${b.miner}`);set('.task-transaction',b.type==='reward'?'採掘のみ':describe(b));
    set('.task-meta',`前Hash ${b.prevHash} / 報酬 ${coin(b.reward)} ＋ 手数料 ${coin(b.fee)} Coin`);
    const data=b.miner+'????'+b.from+String(b.amount).padStart(3,'0')+b.to+b.prevHash;
    set('.digits',data.match(/.{5}/g).join(' '));set('.condition',`成功条件：Hash < ${b.difficulty}`);
    set('.probability',`成功率 ${(b.successCount/100).toFixed(2)}%（目標1/${b.successDenominator}）・先に正解を確定した1人のみ有効`);
    const draft=drafts.get(b.token);if(draft){card.querySelector('[name=nonce]').value=draft.nonce;card.querySelector('[name=hash]').value=draft.hash;}
    card.querySelector('.answer button').disabled=s.failed;$('tasks').append(card);
  }
  $('blocks').replaceChildren();for(const b of s.blocks){const row=document.createElement('tr');const cells=b.type==='genesis'?[0,'Genesis','—','—','—','—','—','0000 → 0000']:[b.index,b.type==='reward'?'採掘':'送金',b.from+' → '+b.to,coin(b.amount),b.miner,coin(b.reward)+' / '+coin(b.fee),b.nonce,b.prevHash+' → '+b.hash];for(const value of cells){const td=document.createElement('td');td.textContent=value;row.append(td);}$('blocks').append(row);}
}
async function act(fn){if(busy)return;busy=true;document.body.setAttribute('aria-busy','true');try{await fn();}catch(e){$('notice').textContent=e.message;try{render(await call('state'));}catch{}}finally{busy=false;document.body.removeAttribute('aria-busy');}}
for(const name of ['prepare','request','settings','lookup'])$(name).addEventListener('submit',event=>{
  event.preventDefault();act(async()=>{const f=Object.fromEntries(new FormData(event.target));
    if(name==='lookup'){const a=await call('lookup',f.id);$('account').textContent=`ID: ${a.id}\n残高: ${coin(a.balance)} Coin\n採掘回数: ${a.miningCount}\n採掘報酬: ${coin(a.rewards)} Coin\n支払手数料: ${coin(a.paidFees)} / 受取手数料: ${coin(a.receivedFees)} Coin`;$('history').textContent=a.history.slice(-20).reverse().map(b=>`#${b.index} ${b.from} → ${b.to} / ${coin(b.amount)} Coin / 採掘者 ${b.miner}`).join(' ｜ ');return;}
    if(name==='prepare')f.requestId=selectedRequest;
    if(name==='settings'){f.successDenominator=Number(f.successDenominator);f.reward=Math.round(Number(f.reward)*10);}
    render(await call(name==='request'?'request:add':name,f));
    $('notice').textContent=name==='prepare'?'問題を発行しました。印刷して採掘者に渡してください。':name==='request'?'送金依頼を掲示しました。付箋をクリックして選べます。':'設定を更新しました。';
    if(name!=='settings')event.target.reset();
  });
});
$('reward').onclick=()=>{if(busy||snapshot?.round)return;selectedRequest=null;render(snapshot);};
$('board').onclick=event=>{
  const select=event.target.closest('[data-request]'),remove=event.target.closest('[data-remove]');
  if(select&&!select.disabled&&!busy){selectedRequest=select.dataset.request;render(snapshot);$('prepare').elements.miner.focus();}
  if(remove&&!remove.disabled)act(async()=>{if(confirm('この送金依頼を取り下げますか？')){render(await call('request:remove',remove.dataset.remove));$('notice').textContent='依頼を取り下げました。';}});
};
$('tasks').addEventListener('submit',event=>{event.preventDefault();const form=event.target,card=form.closest('.task');if(!card)return;act(async()=>{
  const token=card.dataset.token,winner=snapshot.pending.find(b=>b.token===token)?.miner;
  const s=await call('submit',{...Object.fromEntries(new FormData(form)),token});render(s);
  $('notice').textContent=`採掘者 ${winner} が先着で確定しました。台帳へ保存済みです。他の問題は無効になりました。`;
  $('account').textContent='残高が更新されました。IDを再検索してください。';$('history').textContent='';
});});
$('tasks').onclick=event=>{const button=event.target.closest('.print');if(!button||busy)return;const card=button.closest('.task');card.classList.add('print-target');try{window.print();}finally{card.classList.remove('print-target');}};
$('cancel').onclick=()=>act(async()=>{if(confirm('全員の問題を無効にしてラウンドを取り消しますか？ 送金依頼は掲示板に残ります。')){render(await call('cancel'));$('notice').textContent='ラウンドを取り消しました。配布済みの問題は無効です。';}});
$('folder').onclick=()=>act(()=>call('folder'));
$('backup').onclick=()=>act(async()=>{$('notice').textContent=await call('backup')?'バックアップを保存しました。':'バックアップを中止しました。';});
act(async()=>render(await call('state')));
