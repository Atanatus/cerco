const {test}=require('node:test');const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');const path=require('node:path');const fs=require('node:fs');
const {setup,audit,report,events,authorize}=require('./economy-support.cjs');
const moduleOf=name=>import(pathToFileURL(path.resolve('backend/worker',name)).href);

test('cosmetic D1: pending is never spendable; receipts and final reports dedupe; authority settlement is atomic',async t=>{
 const {db,call,guest,start}=await setup(t),g=await guest(),other=await guest(),s=await start(g),a=audit(s);
 const send=ev=>call('/economy/receipts',{match_id:s.match_id,events:ev},g.access_token);
 let w=await (await call('/economy/wallet',undefined,g.access_token)).json();assert.equal(w.balance,0);assert.equal(w.automaticCreditEnabled,false);
 assert.equal((await call('/economy/wallet')).status,401);
 assert.equal((await call('/economy/receipts',{match_id:s.match_id,events:events(a)},other.access_token)).status,403);
 assert.equal((await send([{event:'pickup_collected',detail:{pickupType:'style_coin'}}])).status,400);
 const ev=events(a);assert.equal((await send(ev.slice().reverse())).status,200,'network reordering is accepted, logical seq preserved');
 assert.equal((await send(ev)).status,200);
 const bad=structuredClone(ev);bad[0].detail.coin.value=4;assert.equal((await send(bad)).status,409);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM cosmetic_receipts').first()).n,2);
 const results=await Promise.all([call('/runs/pending',report(s,g,a)),call('/runs/pending',report(s,g,a))]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
 assert.equal((await db.prepare('SELECT state FROM cosmetic_sessions').first()).state,'coherent');
 w=await (await call('/economy/wallet',undefined,g.access_token)).json();assert.equal(w.balance,0);assert.equal(w.pending,5);
 assert.equal((await send(ev)).status,200,'lost stream response recoverable after finalization');
 const {settleAuthorized}=await moduleOf('economy.js');
 await settleAuthorized(db,s.match_id);assert.equal((await db.prepare('SELECT COUNT(*) n FROM cosmetic_ledger').first()).n,0);
 assert.equal((await call('/economy/settle',{match_id:s.match_id},g.access_token)).status,404);
 await authorize(db,s.match_id);
 await Promise.all([settleAuthorized(db,s.match_id),settleAuthorized(db,s.match_id)]);
 await settleAuthorized(db,s.match_id);
 w=await (await call('/economy/wallet',undefined,g.access_token)).json();assert.equal(w.balance,5);assert.equal(w.earned,5);assert.equal(w.pending,0);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM cosmetic_ledger').first()).n,1);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM results').first()).n,0);
 await assert.rejects(db.prepare("UPDATE cosmetic_ledger SET delta=500").run(),/immutable_ledger/);
 await assert.rejects(db.prepare("UPDATE cosmetic_wallets SET balance=-1").run(),/CHECK/);
 // Reapplying the additive migration preserves balances, receipts and history.
 const sql=fs.readFileSync('backend/d1/migrations/0006_cosmetic_rewards.sql','utf8');
 for(const stmt of sql.replace(/--[^\n]*/g,'').replace(/\s+/g,' ').match(/\s*CREATE TRIGGER\b.*?END;|[^;]+;/g))await db.prepare(stmt.trim()).run();
 assert.equal((await db.prepare('SELECT balance FROM cosmetic_wallets').first()).balance,5);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('economic filter recalculates all evidence and rejects manipulated/ineligible rewards',async t=>{
 const {validateEconomy}=await moduleOf('cosmetic-validation.js');
 const s={runId:'test',run_id:'test',ruleset:'CERCO-0.9.0'},good=audit(s);
 assert.equal(validateEconomy(good,s,5).state,'coherent');
 const mutations={
  replay:a=>a.seedReplay=true,abandon:a=>a.result='abandoned',incomplete:a=>a.result=null,
  wrongRun:a=>a.runId='other',wrongRuleset:a=>a.ruleset='CERCO-0.8.2',
  missingRoomTimes:a=>delete a.rooms[0].finishedActiveSeconds,
  malformedReceipt:a=>a.cosmeticEconomy.receipts=[null],malformedRoom:a=>a.rooms=[null],
  expired:a=>a.cosmeticEconomy.receipts[0].collectedAtActiveSeconds=25,
  beforeSpawn:a=>a.cosmeticEconomy.receipts[0].collectedAtActiveSeconds=0,
  duplicate:a=>a.cosmeticEconomy.receipts.push(a.cosmeticEconomy.receipts[0]),
  invalidValue:a=>a.cosmeticEconomy.spawns[0].value=99,fraction:a=>a.cosmeticEconomy.spawns[0].value=2.5,
  bandCap:a=>{a.cosmeticEconomy.spawns=Array.from({length:9},(_,i)=>({...a.cosmeticEconomy.spawns[0],dropId:a.runId+':coin:'+(i+1),value:5,eligibleKillNumberInRoom:i+1}));a.rooms[0].killBuckets={'normal|1.00|normal':9};},
  sanctuary:a=>a.cosmeticEconomy.spawns[0].room=5,boss:a=>a.cosmeticEconomy.spawns[0].enemyType='boss',
  excludedKill:a=>a.rooms[0].killBuckets={'normal|1.00|nuke':2},
  wrongTotal:a=>a.cosmeticEconomy.collected++,wrongFinal:a=>a.final.styleCoinsRun++,
  fakeDiagnostic:a=>{a.cosmeticEconomy.receipts[0].value=999;a.cosmeticEconomy.diagnosticChecks={receiptSumMatchesTotal:true};},
  missingSpawn:a=>a.cosmeticEconomy.spawns.pop(),wrongBreakdown:a=>a.cosmeticEconomy.bands[0].spawnedValue++,
  reusedKill:a=>a.cosmeticEconomy.spawns[1].eligibleKillNumberInRoom=1,
  order:a=>a.cosmeticEconomy.spawns.reverse()
 };
 for(const [name,mutate]of Object.entries(mutations))await t.test(name,()=>{const a=structuredClone(good);mutate(a);assert.equal(validateEconomy(a,s,5).state,'rejected');});
 assert.equal(validateEconomy(good,s,-100).state,'rejected','server duration bound');
 const uncollected=structuredClone(good);uncollected.cosmeticEconomy.receipts.pop();
 uncollected.final.styleCoinsRun=uncollected.cosmeticEconomy.collected=2;uncollected.cosmeticEconomy.collectedCount=1;
 for(const r of [...uncollected.cosmeticEconomy.rooms,...uncollected.cosmeticEconomy.bands]){r.collectedValue=2;r.collectedCount=1;}
 assert.equal(validateEconomy(uncollected,s,5).amount,2,'spawned but uncollected grants no pending value');
});

test('receipts racing finalization, conflicts, abandonment and closed sessions cannot produce credit',async t=>{
 const {db,call,guest,start}=await setup(t),g=await guest(),s=await start(g),a=audit(s),ev=events(a);
 await Promise.all([call('/economy/receipts',{match_id:s.match_id,events:ev},g.access_token),call('/runs/pending',report(s,g,a))]);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM cosmetic_receipts').first()).n,2);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM cosmetic_ledger').first()).n,0);
 const abandoned=await start(g);await call('/matches/abandon',abandoned);
 assert.equal((await call('/economy/receipts',{match_id:abandoned.match_id,events:events(audit(abandoned))},g.access_token)).status,409);
 assert.equal((await call('/runs/pending',report(abandoned,g,audit(abandoned)))).status,409);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM results').first()).n,0);
});
