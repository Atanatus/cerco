/* Server-backed cosmetics. Storage holds retry keys only, never balance/ownership proof. */
(() => {
 'use strict';
 const API='https://cerco-api.atanatus.workers.dev',KEY='cerco_cosmetic_orders_v1';
 let state=null,loading=null,operation=null,generation=0,identityEpoch=0,status='loading';
 let guestId=window.CERCO_GUEST_PROFILE?.getProfile()?.guestId||null, memoryOrders=[];
 const notify=()=>window.dispatchEvent(new CustomEvent('cerco:cosmetics',{detail:{available:!!state,status}}));
 const currentGuest=()=>window.CERCO_GUEST_PROFILE?.getProfile()?.guestId||null;
 function assertGuest(id,epoch) {if(!id||id!==currentGuest()||epoch!==identityEpoch)throw new Error('Guest changed');}
 function inventory(value) {
  if(!value||value.authenticated!==true||value.guest_id!==window.CERCO_GUEST_PROFILE.getProfile()?.guestId||
     value.schema!=='cerco.inventory.v1'||!Array.isArray(value.ownedSkinIds)||!value.ownedSkinIds.includes('cerco.default')||!Array.isArray(value.items)||
     !value.items.every(i=>i&&typeof i.product_id==='string'&&typeof i.name==='string'&&typeof i.asset_path==='string'&&
      ['game_skin','profile_picture'].includes(i.category)&&[0,1].includes(i.active))||
     !value.items.some(i=>i.product_id===value.equippedSkinId&&i.category==='game_skin'&&i.active)||
     !value.ownedSkinIds.includes(value.equippedSkinId)||
     (value.equippedPictureId!==null&&!value.items.some(i=>i.product_id===value.equippedPictureId&&i.category==='profile_picture'&&i.active))||
     value.wallet?.currencyId!=='atanatus.style_coins'||
     !['balance','earned','pending'].every(k=>Number.isSafeInteger(value.wallet[k])&&value.wallet[k]>=0)||
     value.wallet.automaticCreditEnabled!==false)throw new Error('Invalid cosmetics response');
  return value;
 }
 async function request(path,body,expectedGuest) {
  if(!await window.CERCO_GUEST_PROFILE.ready)throw new Error('Profile unavailable');
  const id=expectedGuest||currentGuest(),epoch=identityEpoch;
  assertGuest(id,epoch);
  const headers=await window.CERCO_GUEST_PROFILE.authorizationHeaders();
  assertGuest(id,epoch);
  const r=await fetch(API+path,{method:body?'POST':'GET',headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(8000)});
  const data=await r.json();assertGuest(id,epoch);
  if(!r.ok){const e=new Error(data.error||'Cosmetics unavailable');e.status=r.status;throw e;}
  return data;
 }
 function records() {
  try {const saved=JSON.parse(localStorage.getItem(KEY)||'[]'),rows=[...memoryOrders,...(Array.isArray(saved)?saved:[])];return rows.filter((r,i)=>
   r&&typeof r.guest==='string'&&typeof r.product==='string'&&/^[0-9a-f-]{36}$/.test(r.key)&&
   Number.isSafeInteger(r.expires)&&r.expires>Date.now()&&r.expires<=Date.now()+21600000&&rows.findIndex(v=>v?.key===r.key)===i).slice(-8);}catch(_){return memoryOrders;}
 }
 function save(rows){memoryOrders=rows;try{localStorage.setItem(KEY,JSON.stringify(rows));}catch(_){/* Non-secret retry keys remain in memory. */}}
 async function refresh() {
  if(loading)return loading;
  const epoch=++generation;
  status='loading';notify();
  loading=(async()=>{try{
   const data=await request('/shop/catalog');inventory(data.inventory);
   if(data.currencyId!=='atanatus.style_coins'||!Array.isArray(data.products)||!Array.isArray(data.categories)||
    !data.products.every(p=>p&&typeof p.product_id==='string'&&Number.isSafeInteger(p.price)&&p.price>=0&&[0,1].includes(p.active))||
    !data.categories.every(c=>c&&['game_skin','profile_picture'].includes(c.category)&&Number.isSafeInteger(c.price)&&c.price>0))throw new Error();
   if(epoch===generation){state=data;status='ready';notify();}return data;
  }catch(e){if(epoch===generation){state=null;status='error';notify();}throw e;}finally{if(epoch===generation)loading=null;}})();return loading;
 }
 async function purchase(productId) {
  if(operation)throw new Error('A purchase is already pending');
  const reservation={},initialGuest=currentGuest(),epoch=identityEpoch;operation=reservation;
  try {
  await window.CERCO_GUEST_PROFILE.ready;
  const profile=window.CERCO_GUEST_PROFILE.getProfile();if(!profile)throw new Error('Profile unavailable');
  if(initialGuest)assertGuest(initialGuest,epoch);
  const purchaseEpoch=identityEpoch;
  const rows=records(),previous=rows.find(r=>r.guest===profile.guestId&&r.product===productId);
  const record=previous||{guest:profile.guestId,product:productId,key:crypto.randomUUID(),expires:Date.now()+21600000};
  if(!previous)save([...rows,record].slice(-8));
   let data;
   for(let attempt=0;attempt<2;attempt++) {
    try {data=await request('/shop/purchase',{productId,operationKey:record.key},profile.guestId);break;}
    catch(e){if(attempt===1||(e.status&&e.status<500&&e.status!==429))throw e;await new Promise(r=>setTimeout(r,1000));}
   }
   if(data?.purchased!==true&&data?.owned!==true)throw new Error('Purchase unconfirmed');
   const inv=inventory(data.inventory);if(!inv.items.some(i=>i.product_id===productId))throw new Error('Ownership unconfirmed');
   generation++;loading=null;if(state)state={...state,inventory:inv};status='ready';save(records().filter(r=>r.key!==record.key));notify();
   // The receipt confirms the purchase even if this follow-up read is unavailable.
   await refresh().catch(()=>{});assertGuest(profile.guestId,purchaseEpoch);return inv;
  }finally{if(operation===reservation)operation=null;}
 }
 async function equip(productId,category='game_skin') {
  if(!['game_skin','profile_picture'].includes(category))throw new Error('Invalid category');
  const id=currentGuest();if(!id)throw new Error('Profile unavailable');
  const data=await request(category==='game_skin'?'/skins/equip':'/profile-picture/equip',{productId},id);
  inventory(data);if(data.cosmeticOnly!==true||data[category==='game_skin'?'equippedSkinId':'equippedPictureId']!==productId)throw new Error('Equipment unconfirmed');
  generation++;loading=null;if(state)state={...state,inventory:data};status='ready';notify();return data;
 }
 async function receipts(matchId,events,id) {
  const data=await request('/economy/receipts',{match_id:matchId,events},id);
  if(data.accepted!==true||data.verified!==false||!['pending','coherent','rejected','verified','settled'].includes(data.state))throw new Error('Receipts unconfirmed');
  return data;
 }
 save(records());
 window.CERCO_COSMETICS=Object.freeze({refresh,purchase,equip,receipts,getState:()=>state,getStatus:()=>status});
 window.addEventListener('cerco:guest-profile',()=>{
  const id=currentGuest();if(id===guestId)return;
  guestId=id;identityEpoch++;generation++;loading=null;state=null;status=id?'loading':'error';notify();
  if(id)void refresh().catch(()=>{});
 });
 window.addEventListener('cerco:economy-refresh',()=>{void refresh().catch(()=>{});});
})();
