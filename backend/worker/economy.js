import {authenticateGuest} from './guest.js';
import {readLimitedText} from './http.js';
import {CURRENCY,canonical,validCoin,integer,validateEconomy} from './cosmetic-validation.js';
const ORIGIN='https://cerco.atanatus.com';
export const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':ORIGIN,
  'X-Content-Type-Options':'nosniff','Vary':'Origin'}});
export async function economyAccess(request,env) {
  const origin=request.headers.get('Origin');
  if(origin!==ORIGIN && !(request.method==='GET' && origin===null))return {error:json({error:'origin_not_allowed'},403)};
  const guest=await authenticateGuest(request,env);
  if(!guest)return {error:json({error:'guest_profile_required'},401)};
  const now=Date.now(),window=60000;
  const rate=await env.DB.prepare(`INSERT INTO cosmetic_rate_limits VALUES(?,?,1)
   ON CONFLICT(guest_id) DO UPDATE SET
    attempts=CASE WHEN ?-window_started>=? THEN 1 ELSE attempts+1 END,
    window_started=CASE WHEN ?-window_started>=? THEN ? ELSE window_started END RETURNING attempts`)
    .bind(guest.guest_id,now,now,window,now,window,now).first();
  if(rate.attempts>90)return {error:json({error:'rate_limited'},429)};
  return {guest};
}
export async function bodyOf(request,limit=32768) {
  try {const value=JSON.parse(await readLimitedText(request,limit));
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return {value};
  }catch(e){return {error:json({error:e.tooLarge?'request_too_large':'invalid_json'},e.tooLarge?413:400)};}
}
export async function wallet(db,guestId) {
  const balance=await db.prepare('SELECT balance,earned FROM cosmetic_wallets WHERE guest_id=? AND currency_id=?').bind(guestId,CURRENCY).first();
  const pending=await db.prepare(`SELECT COALESCE(SUM(amount),0) amount FROM cosmetic_sessions
    WHERE guest_id=? AND state IN('pending','coherent','verified')`).bind(guestId).first();
  return {currencyId:CURRENCY,balance:balance?.balance||0,earned:balance?.earned||0,pending:pending.amount,
    automaticCreditEnabled:false,verification:'independent_authority_required'};
}
export async function routeEconomy(request,env) {
  try {
    const {guest,error}=await economyAccess(request,env);if(error)return error;
    const path=new URL(request.url).pathname;
    if(path==='/economy/wallet'&&request.method==='GET')return json(await wallet(env.DB,guest.guest_id));
    if(path!=='/economy/receipts'||request.method!=='POST')return json({error:'not_found'},404);
    const parsed=await bodyOf(request);if(parsed.error)return parsed.error;const body=parsed.value;
    if(typeof body.match_id!=='string'||!Array.isArray(body.events)||body.events.length<1||body.events.length>32)return json({error:'invalid_receipts'},400);
    const s=await env.DB.prepare(`SELECT s.*,m.status FROM cosmetic_sessions s JOIN matches m ON m.match_id=s.match_id
      WHERE s.match_id=? AND s.guest_id=? AND m.guest_id=s.guest_id`).bind(body.match_id,guest.guest_id).first();
    if(!s)return json({error:'session_not_owned'},403);
    const rows=(await env.DB.prepare('SELECT * FROM cosmetic_receipts WHERE match_id=?').bind(s.match_id).all()).results;
    const merged=new Map(rows.map(r=>[r.drop_id,{...r}]));
    for(const event of body.events){
      const collected=event?.event==='cosmetic_coin_collected';
      const d=event?.detail;
      if(!['cosmetic_coin_spawned','cosmetic_coin_collected'].includes(event?.event)||
         !d||d.runId!==s.run_id||d.gameVersion!=='0.9.0'||d.ruleset!==s.ruleset||d.seedReplay!==false||
         d.creditable!==false||d.trust!=='client_reported_unverified'||d.currencyId!==CURRENCY||
         !integer(d.eventSeq,1,100000000)||!validCoin(d.coin,s.run_id,collected))return json({error:'invalid_receipt'},400);
      const row=merged.get(d.coin.dropId)||{drop_id:d.coin.dropId,spawn_json:null,receipt_json:null,spawn_seq:null,receipt_seq:null};
      const field=collected?'receipt_json':'spawn_json',seq=collected?'receipt_seq':'spawn_seq',payload=canonical(d.coin);
      if(row[field] && row[field]!==payload)return json({error:'receipt_conflict'},409);
      if(row[seq]!==null&&row[seq]!==d.eventSeq)return json({error:'sequence_conflict'},409);
      row[field]=payload;row[seq]=d.eventSeq;merged.set(row.drop_id,row);
    }
    if(merged.size>512)return json({error:'receipt_limit'},413);
    if(s.state!=='pending'||s.status!=='active') {
      // A lost response after finalization may be acknowledged only if already identical.
      if([...merged.values()].every(r=>rows.some(old=>old.drop_id===r.drop_id &&
        (!r.spawn_json||old.spawn_json===r.spawn_json)&&(!r.receipt_json||old.receipt_json===r.receipt_json))))
        return json({accepted:true,state:s.state,verified:false});
      return json({error:'session_closed'},409);
    }
    const changed=[...merged.values()].filter(r=>body.events.some(e=>e.detail.coin.dropId===r.drop_id));
    // Each conditional UPSERT merges independent spawn/collection arrivals; never replaces
    // conflicting content. Constraint guards roll back the full batch on races.
    await env.DB.batch(changed.map(r=>env.DB.prepare(`INSERT INTO cosmetic_receipts
     (match_id,drop_id,spawn_json,receipt_json,spawn_seq,receipt_seq)
     SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM matches WHERE match_id=? AND status='active')
     ON CONFLICT(match_id,drop_id) DO UPDATE SET
      spawn_json=COALESCE(excluded.spawn_json,cosmetic_receipts.spawn_json),
      receipt_json=COALESCE(excluded.receipt_json,cosmetic_receipts.receipt_json),
      spawn_seq=COALESCE(excluded.spawn_seq,cosmetic_receipts.spawn_seq),
      receipt_seq=COALESCE(excluded.receipt_seq,cosmetic_receipts.receipt_seq)`)
      .bind(s.match_id,r.drop_id,r.spawn_json,r.receipt_json,r.spawn_seq,r.receipt_seq,s.match_id)));
    const after=(await env.DB.prepare('SELECT * FROM cosmetic_receipts WHERE match_id=?').bind(s.match_id).all()).results;
    if(changed.some(r=>!after.some(a=>a.drop_id===r.drop_id&&(!r.spawn_json||a.spawn_json===r.spawn_json)&&(!r.receipt_json||a.receipt_json===r.receipt_json))))
      return json({error:'receipt_conflict'},409);
    return json({accepted:true,state:'pending',verified:false});
  }catch(_){return json({error:'economy_unavailable'},503);}
}
export async function reconcileEconomy(db,matchId,audit) {
  const s=await db.prepare(`SELECT s.*,m.status, (julianday('now')-julianday(s.created_at))*86400 elapsed
    FROM cosmetic_sessions s JOIN matches m ON m.match_id=s.match_id WHERE s.match_id=?`).bind(matchId).first();
  if(!s||s.state!=='pending'||s.status!=='completed')return;
  const outcome=validateEconomy(audit,s,s.elapsed);
  const rows=(await db.prepare('SELECT * FROM cosmetic_receipts WHERE match_id=?').bind(matchId).all()).results;
  const sequence=rows.flatMap(r=>[
    ...(r.spawn_seq!==null?[{seq:r.spawn_seq,time:JSON.parse(r.spawn_json).spawnedAtActiveSeconds}]:[]),
    ...(r.receipt_seq!==null?[{seq:r.receipt_seq,time:JSON.parse(r.receipt_json).collectedAtActiveSeconds}]:[])
  ]).sort((a,b)=>a.seq-b.seq);
  const invalidSequence=sequence.some((e,i)=>i>0 && (e.seq===sequence[i-1].seq||e.time<sequence[i-1].time));
  if(outcome.state==='coherent' && (invalidSequence || rows.some(r=>
    (r.spawn_json && !audit.cosmeticEconomy.spawns.some(c=>c.dropId===r.drop_id&&canonical(c)===r.spawn_json)) ||
    (r.receipt_json && !audit.cosmeticEconomy.receipts.some(c=>c.dropId===r.drop_id&&canonical(c)===r.receipt_json)) ||
    (r.spawn_seq!==null && r.receipt_seq!==null && r.receipt_seq<=r.spawn_seq)))) {
    outcome.state='rejected';outcome.amount=0;outcome.reason='stream_final_mismatch';
  }
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(audit)));
  const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const statements=[];
  if(outcome.state==='coherent')for(const coin of audit.cosmeticEconomy.spawns){
    const receipt=audit.cosmeticEconomy.receipts.find(r=>r.dropId===coin.dropId);
    statements.push(db.prepare(`INSERT INTO cosmetic_receipts(match_id,drop_id,spawn_json,receipt_json)
     VALUES(?,?,?,?) ON CONFLICT(match_id,drop_id) DO UPDATE SET
      spawn_json=COALESCE(cosmetic_receipts.spawn_json,excluded.spawn_json),
      receipt_json=COALESCE(cosmetic_receipts.receipt_json,excluded.receipt_json)`)
      .bind(matchId,coin.dropId,canonical(coin),receipt?canonical(receipt):null));
  }
  statements.push(db.prepare(`UPDATE cosmetic_sessions SET state=?,amount=?,reason=?,report_hash=?
    WHERE match_id=? AND state='pending'`).bind(outcome.state,outcome.amount,outcome.reason,hash,matchId));
  await db.batch(statements);
}
// Deliberately not routed from HTTP, Cron or automatic report ingestion.
// A future independent authority may call this after issuing a matching attestation.
export async function settleAuthorized(db,matchId) {
  await db.batch([
    db.prepare(`UPDATE cosmetic_sessions SET state='verified' WHERE match_id=? AND state='coherent'
      AND EXISTS(SELECT 1 FROM cosmetic_authorizations a WHERE a.match_id=cosmetic_sessions.match_id
       AND a.report_hash=cosmetic_sessions.report_hash AND a.amount=cosmetic_sessions.amount)`).bind(matchId),
    db.prepare(`INSERT INTO cosmetic_ledger(entry_id,guest_id,currency_id,delta,source_type,source_id)
      SELECT ?,guest_id,?,amount,'reward',match_id FROM cosmetic_sessions WHERE match_id=? AND state='verified'
       AND amount>0 AND NOT EXISTS(SELECT 1 FROM cosmetic_ledger WHERE source_type='reward' AND source_id=?)`)
      .bind(crypto.randomUUID(),CURRENCY,matchId,matchId)
  ]);
}
