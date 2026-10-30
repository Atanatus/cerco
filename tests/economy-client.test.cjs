const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {setup,fund,audit,events}=require('./economy-support.cjs');
const {origin}=require('./support.cjs');
const flush=()=>new Promise(r=>setImmediate(r));
async function until(condition){const end=Date.now()+5000;while(!await condition()){assert.ok(Date.now()<end,'operation timed out');await new Promise(r=>setTimeout(r,5));}}
function gate(){let release;const promise=new Promise(r=>release=r);return {promise,release};}
function host(api,initial,options={}){
 let guest=initial,next=1;const timers=new Map(),listeners=new Map(),storage=options.storage||new Map(),calls=[];
 const frame={contentWindow:{},addEventListener:(_,fn)=>frame.load=fn};
 const window={location:{origin},addEventListener:(name,fn)=>listeners.set(name,[...(listeners.get(name)||[]),fn]),
  dispatchEvent:e=>{for(const fn of listeners.get(e.type)||[])fn(e);},
  CERCO_GUEST_PROFILE:{ready:options.ready||Promise.resolve(true),getProfile:()=>guest?{guestId:guest.guest_id}:null,
   getAccessToken:async()=>guest.access_token,authorizationHeaders:async()=>({Authorization:'Bearer '+guest.access_token})}};
 const fetcher=async(url,opts)=>{
  const route=new URL(url).pathname,body=opts.body?JSON.parse(opts.body):undefined;
  calls.push({route,body});
  const send=()=>api.call(route,body,opts.headers.Authorization?.slice(7));
  return options.fetch?options.fetch({route,body,send}):send();
 };
 const context={window,document:{getElementById:()=>frame},crypto,AbortController,AbortSignal,CustomEvent,
  navigator:{},console:{info(){},warn(){}},fetch:fetcher,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(options.noStorage)throw Error();storage.set(k,v);},
   removeItem:k=>storage.delete(k),get length(){return storage.size;},key:i=>[...storage.keys()][i]},
  setTimeout:(fn,delay)=>{const id=next++;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),setInterval:()=>0};
 vm.createContext(context);
 for(const file of ['economy-client.js','cerco-sessions.js'])vm.runInContext(fs.readFileSync('src/js/'+file,'utf8'),context);
 const emit=(event,detail,override={})=>window.dispatchEvent({type:'message',origin,source:frame.contentWindow,
  data:{source:'CERCO',protocol:1,event,detail},...override});
 return {window,service:window.CERCO_COSMETICS,calls,storage,timers,frame,emit,
  switchGuest:g=>{guest=g;window.dispatchEvent({type:'cerco:guest-profile'});},
  start:(runId=crypto.randomUUID())=>{emit('run_started',{runId,gameVersion:'0.9.0',ruleset:'CERCO-0.9.0',auditSchema:'cerco.audit.v2'});return runId;},
  finish:a=>emit('run_finished',{runId:a.runId,score:a.final.score,kills:a.final.kills,room:a.final.room,seed:a.seed,activeSeconds:a.activeSeconds,audit:a}),
  tick:async()=>{const row=[...timers][0];if(row){timers.delete(row[0]);row[1].fn();await flush();}return !!row;}};
}

test('frontend -> local D1: bounded receipts, dedupe, final reconciliation and pending never spendable',async t=>{
 const api=await setup(t),g=await api.guest(),started=gate();
 const h=host(api,g,{fetch:async r=>{if(r.route==='/matches/start')await started.promise;return r.send();}});
 const runId=h.start(),a=audit({runId}),ev=events(a);
 await h.service.refresh();assert.equal(h.service.getState().inventory.wallet.balance,0);
 for(const e of [...ev,...ev])h.emit(e.event,e.detail);
 h.emit('pickup_collected',{runId,pickupType:'style_coin'});
 h.emit(ev[0].event,ev[0].detail,{source:{}});h.emit(ev[0].event,ev[0].detail,{origin:'https://evil.test'});
 assert.equal(h.calls.filter(c=>c.route==='/economy/receipts').length,0);
 started.release();await until(()=>h.calls.some(c=>c.route==='/economy/receipts'));
 await until(async()=> (await api.db.prepare('SELECT COUNT(*) n FROM cosmetic_receipts').first()).n===2);
 assert.equal(h.calls.find(c=>c.route==='/economy/receipts').body.events.length,4);
 const id=h.window.CERCO_SESSION_STATUS().match_id;
 assert.equal((await api.db.prepare('SELECT run_id FROM cosmetic_sessions WHERE match_id=?').bind(id).first()).run_id,runId);
 h.finish(a);h.finish(a);await until(()=>h.window.CERCO_SESSION_STATUS().report_stored);
 await h.service.refresh();const wallet=h.service.getState().inventory.wallet;
 assert.equal(wallet.balance,0);assert.equal(wallet.pending,5);assert.equal(wallet.automaticCreditEnabled,false);
 await assert.rejects(h.service.purchase('cerco.void_circuit'),/insufficient_funds/);
 assert.equal((await api.db.prepare('SELECT COUNT(*) n FROM cosmetic_ledger').first()).n,0);
 assert.equal((await api.db.prepare('SELECT COUNT(*) n FROM pending_run_reports').first()).n,1);
 assert.equal((await api.db.prepare('SELECT COUNT(*) n FROM results').first()).n,0);
 const other=await api.start(g);
 assert.equal((await api.call('/economy/receipts',{match_id:other.match_id,events:ev},g.access_token)).status,400);
});

test('frontend: delayed starts, identity changes, frame reload and early finish cannot cross sessions',async t=>{
 const api=await setup(t),g=await api.guest(),other=await api.guest(),hold=gate();let delayed=true;
 const h=host(api,g,{fetch:async r=>{const response=await r.send();if(r.route==='/matches/start'&&delayed)await hold.promise;return response;}});
 const old=h.start();await until(()=>h.calls.some(c=>c.route==='/matches/start'));
 h.frame.load();delayed=false;const next=h.start();await until(()=>h.window.CERCO_SESSION_STATUS().match_id);
 const nextId=h.window.CERCO_SESSION_STATUS().match_id;hold.release();await flush();
 for(const e of events(audit({runId:old})))h.emit(e.event,e.detail);
 assert.equal(h.window.CERCO_SESSION_STATUS().run_id,next);assert.equal(h.window.CERCO_SESSION_STATUS().match_id,nextId);
 h.switchGuest(other);assert.equal(h.window.CERCO_SESSION_STATUS().run_id,null);
 for(const e of events(audit({runId:next})))h.emit(e.event,e.detail);
 assert.equal(h.calls.filter(c=>c.route==='/economy/receipts').length,0);
 await h.service.refresh();assert.equal(h.service.getState().inventory.guest_id,other.guest_id);
 const ready=gate(),early=host(api,null,{ready:ready.promise});
 const runId=early.start(),a=audit({runId});early.finish(a);early.switchGuest(g);ready.release(true);
 await until(()=>early.window.CERCO_SESSION_STATUS().report_stored);
 assert.equal((await api.db.prepare('SELECT state FROM cosmetic_sessions WHERE run_id=?').bind(runId).first()).state,'coherent');
});

test('frontend: purchase loss reuses one order across retries/reload; concurrency and missing storage are safe',async t=>{
 const api=await setup(t),g=await api.guest();await fund(api,g,5000);
 const storage=new Map();let losses=2;
 const intercept=async r=>{const response=await r.send();if(r.route==='/shop/purchase'&&losses-- > 0)throw Error('lost response');return response;};
 const h=host(api,g,{storage,fetch:intercept});await h.service.refresh();
 const first=h.service.purchase('cerco.void_circuit');const rejected=assert.rejects(first,/lost response/);
 await assert.rejects(h.service.purchase('cerco.void_circuit'),/already pending/);
 await until(()=>h.calls.filter(c=>c.route==='/shop/purchase').length===1);
 await until(()=>[...h.timers.values()].some(v=>v.delay===1000));await h.tick();await rejected;
 const keys=h.calls.filter(c=>c.route==='/shop/purchase').map(c=>c.body.operationKey);assert.equal(new Set(keys).size,1);
 const reloaded=host(api,g,{storage,fetch:intercept});await reloaded.service.refresh();
 await reloaded.service.purchase('cerco.void_circuit');
 assert.equal(reloaded.calls.find(c=>c.route==='/shop/purchase').body.operationKey,keys[0]);
 assert.equal(reloaded.service.getState().inventory.wallet.balance,2000);
 await reloaded.service.equip('cerco.void_circuit');await reloaded.service.refresh();
 assert.equal(reloaded.service.getState().inventory.equippedSkinId,'cerco.void_circuit');
 assert.equal((await api.db.prepare('SELECT COUNT(*) n FROM cosmetic_purchases').first()).n,1);
 assert.equal(storage.get('cerco_cosmetic_orders_v1'),'[]');
 const other=await api.guest();await fund(api,other,3000);losses=2;
 const memory=host(api,other,{noStorage:true,fetch:intercept});
 const one=assert.rejects(memory.service.purchase('cerco.void_circuit'),/lost response/);
 await until(()=>memory.calls.filter(c=>c.route==='/shop/purchase').length===1);
 await until(()=>memory.timers.size>0);await memory.tick();await one;
 await memory.service.purchase('cerco.void_circuit');
 assert.equal(new Set(memory.calls.filter(c=>c.route==='/shop/purchase').map(c=>c.body.operationKey)).size,1);
});

test('frontend: stale catalog and purchases cannot overwrite a different Guest',async t=>{
 const api=await setup(t),g=await api.guest(),other=await api.guest(),held=gate();let delay=true;
 await fund(api,g,3000);
 const h=host(api,g,{fetch:async r=>{const result=await r.send();if(delay&&r.route==='/shop/catalog')await held.promise;return result;}});
 const old=h.service.refresh();const rejected=assert.rejects(old,/Guest changed/);
 await until(()=>h.calls.some(c=>c.route==='/shop/catalog'));delay=false;h.switchGuest(other);
 await h.service.refresh();held.release();await rejected;
 assert.equal(h.service.getState().inventory.guest_id,other.guest_id);assert.equal(h.service.getState().inventory.wallet.balance,0);
 const purchaseGate=gate();let committed=false;
 const purchaser=host(api,g,{fetch:async r=>{const result=await r.send();if(r.route==='/shop/purchase'){committed=true;await purchaseGate.promise;}return result;}});
 await purchaser.service.refresh();const buying=assert.rejects(purchaser.service.purchase('cerco.void_circuit'),/Guest changed/);
 await until(()=>committed);purchaser.switchGuest(other);await purchaser.service.refresh();purchaseGate.release();
 await until(()=>purchaser.timers.size>0);await purchaser.tick();await buying;
 assert.equal(purchaser.service.getState().inventory.guest_id,other.guest_id);
 assert.deepEqual(Array.from(purchaser.service.getState().inventory.ownedSkinIds),['cerco.default']);
 const followup=gate();let bought=false,readHeld=false;
 const follow=host(api,g,{fetch:async r=>{const result=await r.send();
  if(r.route==='/shop/purchase')bought=true;
  if(bought&&!readHeld&&r.route==='/shop/catalog'){readHeld=true;await followup.promise;}return result;}});
 await follow.service.refresh();const confirming=assert.rejects(follow.service.purchase('cerco.void_circuit'),/Guest changed/);
 await until(()=>readHeld);follow.switchGuest(other);await follow.service.refresh();followup.release();await confirming;
 assert.equal(follow.service.getState().inventory.guest_id,other.guest_id);
});

test('frontend: receipt retry budget, queue cap, invalid payload and abandonment stay bounded',async t=>{
 const api=await setup(t),g=await api.guest();let losses=0;
 const h=host(api,g,{fetch:async r=>{if(r.route==='/economy/receipts'){losses++;return new Response('{"error":"offline"}',{status:503});}return r.send();}});
 const id=h.start();await until(()=>h.window.CERCO_SESSION_STATUS().match_id);const ev=events(audit({runId:id}));
 h.emit(ev[0].event,{...ev[0].detail,extra:'x'.repeat(120001)});
 h.emit(ev[0].event,{...ev[0].detail,coin:{...ev[0].detail.coin,value:'5'}});
 assert.equal(h.timers.size,0);
 h.emit(ev[0].event,ev[0].detail);
 for(let i=1;i<=4;i++){await h.tick();await until(()=>losses===i);await flush();}
 assert.equal(losses,4);assert.equal(h.timers.size,0);
 h.emit('run_abandoned',{runId:id});await until(()=>h.window.CERCO_SESSION_STATUS().abandon_stored);
 assert.equal((await api.db.prepare('SELECT COUNT(*) n FROM cosmetic_ledger').first()).n,0);
 const hold=gate(),bounded=host(api,g,{fetch:async r=>{if(r.route==='/matches/start')await hold.promise;return r.send();}});
 const runId=bounded.start(),base=events(audit({runId}))[0];
 for(let i=1;i<=1025;i++)bounded.emit(base.event,{...base.detail,eventSeq:i,coin:{...base.detail.coin,dropId:runId+':coin:'+i}});
 hold.release();await until(()=>bounded.window.CERCO_SESSION_STATUS().match_id);
 assert.equal(bounded.calls.filter(c=>c.route==='/economy/receipts').length,0);assert.equal(bounded.timers.size,0);
});
