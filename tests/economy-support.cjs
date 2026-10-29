const {createRuntime,schema,origin}=require('./support.cjs');
exports.setup=async t=>{
 const mf=createRuntime({modules:true,scriptPath:'backend/worker/index.js',compatibilityDate:'2026-10-26',d1Databases:['DB']});
 t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');await schema(db);
 const call=(path,body,token)=>mf.dispatchFetch('https://local.test'+path,{method:body===undefined?'GET':'POST',
  headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.205',...(token?{Authorization:'Bearer '+token}:{})},
  body:body===undefined?undefined:JSON.stringify(body)});
 const guest=async()=>{const r=await call('/guest/profile',{recovery_token:require('node:crypto').randomBytes(32).toString('hex'),create:true});return r.json();};
 const start=async g=>{const runId=crypto.randomUUID();const r=await call('/matches/start',{
  game_version:'0.9.0',mode:'expedition',client_run_id:runId,ruleset:'CERCO-0.9.0'},g.access_token);
  return {...await r.json(),runId};};
 return {mf,db,call,guest,start};
};
exports.audit=(s)=>{
 const spawns=[2,3].map((value,i)=>({dropId:s.runId+':coin:'+(i+1),room:1,band:1,currencyId:'atanatus.style_coins',value,
  enemyType:'normal',eligibleKillNumberInRoom:i+1,spawnedAtActiveSeconds:i+1}));
 const receipts=spawns.map(c=>({...c,collectedAtActiveSeconds:c.spawnedAtActiveSeconds+1}));
 return {schema:'cerco.audit.v2',gameVersion:'0.9.0',ruleset:'CERCO-0.9.0',runId:s.runId,seed:42,seedReplay:false,
  result:'defeat',activeSeconds:5,trust:'client_reported_unverified',final:{room:1,kills:2,score:200,credits:0,styleCoinsRun:5,styleCoinsVerified:false},
  rooms:[{room:1,type:'combat',startedActiveSeconds:0,finishedActiveSeconds:5,killBuckets:{'normal|1.00|normal':2}}],
  diagnosticChecks:{scoreAddsUp:true,killsAddUp:true,creditsAddUp:true},
  cosmeticEconomy:{schema:'cerco.cosmetics.v1',currencyId:'atanatus.style_coins',collected:5,collectedCount:2,spawnedValue:5,spawnedCount:2,
   rooms:[{room:1,spawnedValue:5,spawnedCount:2,collectedValue:5,collectedCount:2}],
   bands:[{band:1,spawnedValue:5,spawnedCount:2,collectedValue:5,collectedCount:2}],spawns,receipts,
   trust:'client_reported_unverified',serverWalletCredited:false}};
};
exports.report=(s,g,a)=>({match_id:s.match_id,session_token:s.session_token,guest_id:g.guest_id,run_id:s.runId,
 score:a.final.score,kills:a.final.kills,room:a.final.room,seed:a.seed,active_seconds:a.activeSeconds,audit:a});
exports.events=(a)=>a.cosmeticEconomy.spawns.flatMap((coin,i)=>[
 {event:'cosmetic_coin_spawned',detail:{runId:a.runId,gameVersion:a.gameVersion,ruleset:a.ruleset,eventSeq:i*2+3,seedReplay:false,currencyId:coin.currencyId,coin,creditable:false,trust:a.trust}},
 {event:'cosmetic_coin_collected',detail:{runId:a.runId,gameVersion:a.gameVersion,ruleset:a.ruleset,eventSeq:i*2+4,seedReplay:false,currencyId:coin.currencyId,coin:a.cosmeticEconomy.receipts[i],creditable:false,trust:a.trust}}]);
exports.authorize=async(db,id)=>db.prepare(`INSERT INTO cosmetic_authorizations(match_id,report_hash,amount,authority,evidence_ref)
 SELECT match_id,report_hash,amount,'isolated-test-authority','synthetic-fixture' FROM cosmetic_sessions WHERE match_id=?`).bind(id).run();
