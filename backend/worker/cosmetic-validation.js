// Consistency filter only. Client-controlled events cannot prove legitimate gameplay.
export const CURRENCY = 'atanatus.style_coins';
export const POLICY = 'cerco.cosmetics.v1/0.9.0';
const enemies = new Set(['normal','interceptor','flanker','ranged','seeker','blighter','toxic','snarer','healer','shaman','ghost','brute','detonator']);
export const integer = (v,min,max) => Number.isSafeInteger(v) && v>=min && v<=max;
const seconds = v => typeof v==='number' && Number.isFinite(v) && v>=0 && v<=864000;
export function canonical(value) {
  if (!value || typeof value!=='object') return JSON.stringify(value);
  return Array.isArray(value) ? '['+value.map(canonical).join(',')+']' :
    '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
export function coinPolicy(room) {
  const band=Math.floor((room-1)/5)+1;
  return {band,min:band<=5?2*band:Math.min(34,10+2*(band-5)),
    max:band===1?5:band<=5?4*band:Math.min(68,20+4*(band-5)),cap:Math.min(200,40+25*(band-1))};
}
export function validCoin(c,runId,collected=false) {
  return c && typeof c==='object' && !Array.isArray(c) &&
    typeof c.dropId==='string' && c.dropId.startsWith(runId+':coin:') &&
    /^[1-9]\d{0,5}$/.test(c.dropId.slice((runId+':coin:').length)) &&
    integer(c.room,1,100000) && c.room%5!==0 && c.band===coinPolicy(c.room).band &&
    c.currencyId===CURRENCY && integer(c.value,1,coinPolicy(c.room).max) && enemies.has(c.enemyType) &&
    integer(c.eligibleKillNumberInRoom,1,100000000) && seconds(c.spawnedAtActiveSeconds) &&
    (!collected || (seconds(c.collectedAtActiveSeconds) && c.collectedAtActiveSeconds>=c.spawnedAtActiveSeconds &&
     c.collectedAtActiveSeconds-c.spawnedAtActiveSeconds<=18.001));
}
export function validateEconomy(a,session,elapsedSeconds) {
  const reject=reason=>({state:'rejected',amount:0,reason});
  if (a?.gameVersion!=='0.9.0' || a.ruleset!==session.ruleset || a.runId!==session.run_id ||
      a.result!=='defeat' || a.seedReplay!==false || a.trust!=='client_reported_unverified' ||
      !seconds(a.activeSeconds) || a.activeSeconds>elapsedSeconds+30) return reject('ineligible_run');
  const c=a.cosmeticEconomy;
  if (!c || c.schema!=='cerco.cosmetics.v1' || c.currencyId!==CURRENCY || c.serverWalletCredited!==false ||
      c.trust!=='client_reported_unverified' || a.final?.styleCoinsVerified!==false ||
      !Array.isArray(c.spawns) || !Array.isArray(c.receipts) || !Array.isArray(c.rooms) || !Array.isArray(c.bands) ||
      !Array.isArray(a.rooms) || c.spawns.length>512 || c.receipts.length>512 || a.rooms.length>1000) return reject('invalid_economy');
  if(!c.spawns.every(v=>validCoin(v,a.runId)) || !c.receipts.every(v=>validCoin(v,a.runId,true)) ||
     c.rooms.length>1000 || c.bands.length>1000 ||
     ![...c.rooms,...c.bands,...a.rooms].every(v=>v && typeof v==='object' && !Array.isArray(v))) return reject('invalid_economy');
  const spawned=new Map(), received=new Map(), bands=new Map(), rooms=new Map();let spawnedValue=0,total=0,previousTime=0,previousId=0;
  for (const coin of c.spawns) {
    if (!validCoin(coin,a.runId) || spawned.has(coin.dropId)) return reject('invalid_spawn');
    const id=Number(coin.dropId.split(':coin:').pop()),p=coinPolicy(coin.room),used=bands.get(p.band)||0;
    // The game truncates the LAST drop to the remaining generated budget.
    if (id<=previousId || coin.spawnedAtActiveSeconds<previousTime || coin.spawnedAtActiveSeconds>a.activeSeconds ||
        used+coin.value>p.cap || coin.value<Math.min(p.min,p.cap-used)) return reject('band_or_order');
    const room=a.rooms.find(r=>r.room===coin.room && r.type==='combat');
    const eligible=Object.entries(room?.killBuckets||{}).filter(([key])=>key.endsWith('|normal')).reduce((sum,[,n])=>sum+(integer(n,0,100000000)?n:0),0);
    const matchingKill=Object.entries(room?.killBuckets||{}).some(([key,n])=>key.startsWith(coin.enemyType+'|')&&key.endsWith('|normal')&&integer(n,1,100000000));
    const activeCoins=[...spawned.values()].filter(s=>s.room===coin.room && coin.spawnedAtActiveSeconds-s.spawnedAtActiveSeconds<18 &&
      !c.receipts.some(r=>r.dropId===s.dropId && r.collectedAtActiveSeconds<=coin.spawnedAtActiveSeconds)).length;
    if (!room || !seconds(room.startedActiveSeconds) || !seconds(room.finishedActiveSeconds) || activeCoins>=12 ||
        !matchingKill || coin.room>a.final.room || coin.eligibleKillNumberInRoom>eligible ||
        coin.spawnedAtActiveSeconds<room.startedActiveSeconds || coin.spawnedAtActiveSeconds>room.finishedActiveSeconds ||
        [...spawned.values()].some(s=>s.room===coin.room && s.eligibleKillNumberInRoom===coin.eligibleKillNumberInRoom)) return reject('ineligible_kill');
    previousTime=coin.spawnedAtActiveSeconds;previousId=id;spawned.set(coin.dropId,coin);bands.set(p.band,used+coin.value);
    rooms.set(coin.room,(rooms.get(coin.room)||0)+coin.value);spawnedValue+=coin.value;
  }
  for (const coin of c.receipts) {
    if (!validCoin(coin,a.runId,true) || received.has(coin.dropId) || coin.collectedAtActiveSeconds>a.activeSeconds) return reject('invalid_receipt');
    const spawn=spawned.get(coin.dropId),{collectedAtActiveSeconds,...rest}=coin;
    const room=a.rooms.find(r=>r.room===coin.room);
    if (!spawn || canonical(rest)!==canonical(spawn) || collectedAtActiveSeconds>room.finishedActiveSeconds) return reject('spawn_mismatch');
    received.set(coin.dropId,coin);total+=coin.value;
  }
  if (total!==c.collected || total!==a.final.styleCoinsRun || received.size!==c.collectedCount ||
      spawned.size!==c.spawnedCount || spawnedValue!==c.spawnedValue) return reject('total_mismatch');
  for (const [key,field,map] of [['rooms','room',rooms],['bands','band',bands]]) {
    const seen=new Set();
    for (const r of c[key]) {
      if (!integer(r[field],1,100000) || seen.has(r[field])) return reject('invalid_breakdown');seen.add(r[field]);
      const sp=c.spawns.filter(s=>s[field]===r[field]),rc=c.receipts.filter(s=>s[field]===r[field]);
      if (r.spawnedValue!==(map.get(r[field])||0) || r.spawnedCount!==sp.length || r.collectedValue!==rc.reduce((s,v)=>s+v.value,0) ||
          r.collectedCount!==rc.length) return reject('breakdown_mismatch');
    }
    if ([...map.keys()].some(k=>!seen.has(k))) return reject('missing_breakdown');
  }
  return {state:'coherent',amount:total,reason:'awaiting_independent_verification'};
}
