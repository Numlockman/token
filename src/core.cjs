'use strict';
const ZERO = '00000000';
const GENESIS = Object.freeze({version:1,index:0,type:'genesis',hash:'0000',prevHash:'0000'});
const DEFAULTS = Object.freeze({successDenominator:3,reward:10}); // reward: 0.1 Coin units
function check(ok, message) { if (!ok) throw new Error(message); }
function integer(x, min, max) { return Number.isSafeInteger(x) && x >= min && x <= max; }
function id(x) { check(typeof x === 'string' && /^\d{8}$/.test(x) && x !== ZERO,'IDは00000000以外の8桁で入力してください'); return x; }
function units(x) {
  check(typeof x === 'string' && /^\d{1,5}(\.\d)?$/.test(x),'金額は0〜99999.9、少数は1桁までです');
  const [whole, fraction='0'] = x.split('.'); return Number(whole)*10+Number(fraction);
}
function coin(x) { return (x/10).toFixed(1); }
function settings(s) {
  check(s && [3,4].includes(s.successDenominator) && integer(s.reward,1,999999),'成功率は1/3または1/4、報酬は0.1〜99999.9 Coinです');
  return {successDenominator:s.successDenominator,reward:s.reward};
}
function payload(b, nonce=b.nonce) { return b.from+b.to+String(b.amount).padStart(6,'0')+b.prevHash+nonce; }
function hash(data, version=2) {
  check(typeof data === 'string' && /^\d{30}$/.test(data),'計算データは30桁必要です');
  const [A,B,C,D,E,F] = data.match(/.{5}/g).map(Number);
  check(version===1 || version===2,'未対応のハッシュ方式です');
  if(version===2) {
    const X=(A+C+E+F)%1000;
    const Y=(B+D+E+F)%90+10;
    return String((X*Y)%10000).padStart(4,'0');
  }
  const S=(A+3*B+5*C+7*D+9*E+11*F)%10000;
  const H=Math.floor(S*S/100)%10000;
  return String(H).padStart(4,'0');
}
// Select the integer threshold whose successful Nonce count is closest to the goal.
// Ties use the smaller threshold. Answers never leave this calculation.
function calibrate(b, denominator) {
  check([3,4].includes(denominator),'成功率が不正です');
  const histogram=new Uint32Array(10000);
  for(let n=0;n<10000;n++) histogram[Number(hash(payload(b,String(n).padStart(4,'0')),2))]++;
  let total=0, bestError=Infinity, result;
  for(let difficulty=1;difficulty<=10000;difficulty++) {
    total+=histogram[difficulty-1];
    const error=Math.abs(total*denominator-10000);
    if(error<bestError) {bestError=error;result={difficulty,successCount:total};}
  }
  return result;
}
function state() { return {blocks:[],bank:Object.create(null)}; }
function register(s, value) { id(value); if (!(value in s.bank)) s.bank[value]=0; }
function validate(s,b) {
  if (!s.blocks.length) { check(JSON.stringify(b)===JSON.stringify(GENESIS),'Genesisが不正です'); return; }
  check(b && (b.version===1 || b.version===2) && b.index===s.blocks.length,'ブロック番号または形式が不正です');
  check(b.prevHash===s.blocks.at(-1).hash,'前Hashが一致しません');
  check(b.type==='reward'||b.type==='transfer','ブロック種別が不正です');
  id(b.miner);
  check(integer(b.difficulty,1,10000) && integer(b.reward,1,999999),'判定上限または報酬が不正です');
  if(b.version===2) settings(b);
  else check(s.blocks.at(-1).version===1,'旧方式への巻き戻しはできません');
  check(integer(b.amount,0,999999),'金額が不正です');
  check(typeof b.nonce==='string' && /^\d{4}$/.test(b.nonce),'Nonceは4桁です');
  check(typeof b.hash==='string' && /^\d{4}$/.test(b.hash),'Hashは4桁です');
  if (b.type==='reward') check(b.from===ZERO && b.to===b.miner && b.amount===0 && b.fee===0,'報酬ブロックが不正です');
  else {
    id(b.from); id(b.to);
    check(b.amount>0 && b.fee===2,'送金額または手数料が不正です');
    check((s.bank[b.from]||0)>=b.amount+b.fee,'残高不足です（手数料0.2 Coinを含む）');
  }
  check(hash(payload(b),b.version)===b.hash,'Hashの計算結果が一致しません');
  check(Number(b.hash)<b.difficulty,'Hashが判定上限以上です');
  if(b.version===2) {
    const expected=calibrate(b,b.successDenominator);
    check(b.difficulty===expected.difficulty && b.successCount===expected.successCount,'自動ターゲットまたは成功数が不正です');
  }
  const deltas=new Map();
  const add=(who,n)=>deltas.set(who,(deltas.get(who)||0)+n);
  if(b.type==='transfer') { add(b.from,-b.amount-b.fee); add(b.to,b.amount); }
  add(b.miner,b.reward+b.fee);
  for(const [who,n] of deltas) check(Number.isSafeInteger((s.bank[who]||0)+n),'残高の上限を超えます');
}
function apply(s,b) {
  validate(s,b);
  if(b.type!=='genesis') {
    register(s,b.miner);
    if(b.type==='transfer') { register(s,b.from);register(s,b.to);s.bank[b.from]-=b.amount+b.fee;s.bank[b.to]+=b.amount; }
    s.bank[b.miner]+=b.reward+b.fee;
  }
  s.blocks.push(b);
}
function candidate(s,input,config) {
  const rules=settings(config); id(input.miner);
  const b={version:2,index:s.blocks.length,type:input.type,from:ZERO,to:input.miner,amount:0,fee:0,miner:input.miner,...rules,prevHash:s.blocks.at(-1).hash};
  check(input.type==='reward'||input.type==='transfer','採掘の種類を選んでください');
  if(input.type==='transfer') {
    b.from=id(input.from); b.to=id(input.to); b.amount=units(input.amount); b.fee=2;
    check(b.amount>0,'送金額は0より大きい値にしてください');
    check((s.bank[b.from]||0)>=b.amount+2,'残高不足です（手数料0.2 Coinを含む）');
  }
  return {...b,...calibrate(b,rules.successDenominator)};
}
module.exports={ZERO,GENESIS,DEFAULTS,check,id,units,coin,settings,payload,hash,calibrate,state,register,validate,apply,candidate};
