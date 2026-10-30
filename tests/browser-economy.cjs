// Runs only inside browser-smoke's fully intercepted, ephemeral local Worker.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {origin}=require('./support.cjs');
const {fund,audit,report}=require('./economy-support.cjs');
module.exports=async({pageFor,db,mf,base,shots,results})=>{
 console.log('Browser stage: cosmetic economy');
 const page=await pageFor('192.0.2.180',{width:1366,height:768});
 const ready=()=>page.waitForFunction(()=>window.CERCO_COSMETICS.getStatus()==='ready');
 await ready();
 const g=await page.evaluate(async()=>({guest_id:window.CERCO_GUEST_PROFILE.getProfile().guestId,access_token:await window.CERCO_GUEST_PROFILE.getAccessToken()}));
 const call=(route,body,token=g.access_token)=>mf.dispatchFetch('https://local.test'+route,{method:body===undefined?'GET':'POST',
  headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+token},body:body===undefined?undefined:JSON.stringify(body)});
 const api={db,start:async guest=>{const runId=crypto.randomUUID();return {...await(await call('/matches/start',{
  game_version:'0.9.0',mode:'expedition',client_run_id:runId,ruleset:'CERCO-0.9.0'},guest.access_token)).json(),runId};}};
 const shot=async name=>page.screenshot({path:path.join(shots,name+'.png'),fullPage:true});
 const walletDialog=page.locator('#cosmetic-wallet-dialog');
 const walletTrigger=page.locator('#cosmetic-wallet-open');

 const openWallet=async()=>{
  await walletTrigger.click();
  assert.equal(await walletDialog.evaluate(e=>e.open),true);
 };

 const closeWallet=async()=>{
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>
   !document.getElementById('cosmetic-wallet-dialog').open);
 };

 const refreshWallet=async()=>{
  await openWallet();
  await page.locator('#cosmetic-refresh').click();
  await closeWallet();
 };

 assert.equal(await walletDialog.evaluate(e=>e.open),false);
 assert.equal(await page.locator('.player-panel .cosmetic-wallet').count(),0);
 await openWallet();
 assert.equal(await walletDialog.isVisible(),true);
 await shot('economy-wallet-modal');
 await page.locator('#cosmetic-wallet-close').click();
 await page.waitForFunction(()=>
  !document.getElementById('cosmetic-wallet-dialog').open);
 assert.match(await page.locator('#cosmetic-wallet').textContent(),/^0 ✦ confirmed/);
 await page.locator('[data-panel="shop"]').click();await ready();
 const voidCard=page.locator('#pz-shop-skins [data-product-id="cerco.void_circuit"]');
 assert.equal(await voidCard.getByRole('button',{name:'INSUFFICIENT FUNDS',exact:true}).isDisabled(),true);
 assert.match(await voidCard.innerText(),/3,000 ✦/);
 assert.match(await page.locator('#cosmetic-picture-price').innerText(),/1,250 ✦ · COMING SOON/);
 assert.equal(await page.locator('#pz-shop-avatars button').count(),0);
 assert.equal(await page.locator('[data-profile-picture-preview="Profile_Picture2"]').count(),1);
 assert.equal(
   await page.locator('[data-profile-picture-preview="Profile_Picture2"] img').getAttribute('src'),
   './assets/profile-pictures/Profile_Picture2.png'
 );
 assert.equal(
   await page.locator('.player-avatar').evaluate(
     el => getComputedStyle(el).backgroundImage.includes('Profile_Picture1.png')
   ),
   true
 );
 await shot('economy-shop-zero');
 assert.equal((await call('/shop/purchase',{productId:'cerco.void_circuit',operationKey:crypto.randomUUID()})).status,409);
 assert.equal((await call('/skins/equip',{skinId:'cerco.void_circuit'})).status,403);
 assert.equal((await call('/shop/purchase',{productId:'missing.product',operationKey:crypto.randomUUID()})).status,409);

 // A valid synthetic final audit produces pending coins only, never a grant.
 const pending=await api.start(g),a=audit(pending);
 assert.equal((await call('/runs/pending',report(pending,g,a))).status,201);
 await refreshWallet();await ready();
 assert.match(await page.locator('#cosmetic-wallet').textContent(),/^0 ✦ confirmed · 5 ✦ pending/);
 await openWallet();await shot('economy-profile-pending');await closeWallet();
 results.push('Economy UI: zero/pending balances, insufficient funds, authentic prices and absent profile-picture catalog.');

 // Funding is isolated in the ephemeral D1 harness; no browser or public grant API.
 await fund(api,g,5000);await refreshWallet();await ready();
 assert.match(await page.locator('#cosmetic-wallet').textContent(),/^5,000 ✦ confirmed · 5 ✦ pending/);
 await openWallet();await shot('economy-profile-funded');await closeWallet();
 let dropped=false;const orders=[];
 await page.route('**/shop/purchase',async route=>{
  const req=route.request(),body=JSON.parse(req.postData());orders.push(body.operationKey);
  const response=await call('/shop/purchase',body);
  if(!dropped){dropped=true;await route.abort('failed');return;}
  const headers=Object.fromEntries(response.headers);headers['access-control-allow-origin']=base;
  await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});
 });
 await voidCard.getByRole('button',{name:'BUY',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('cosmetic-shop-status').textContent.startsWith('Purchase confirmed.'));
 assert.equal(orders.length,2);assert.equal(new Set(orders).size,1);
 assert.match(await page.locator('#cosmetic-wallet').textContent(),/^2,000 ✦ confirmed · 5 ✦ pending/);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM cosmetic_purchases WHERE guest_id=?').bind(g.guest_id).first()).n,1);
 await shot('economy-shop-owned');await page.unroute('**/shop/purchase');
 await page.locator('#pz-shop-back').click();await page.locator('[data-panel="settings"]').click();await ready();
 assert.equal(await page.locator('#pz-skins-grid .cerco-skin-card').count(),2);
 await page.locator('#pz-skins-grid [data-product-id="cerco.void_circuit"]').getByRole('button',{name:'EQUIP',exact:true}).click();
 await page.waitForFunction(()=>window.CERCO_COSMETICS.getState()?.inventory.equippedSkinId==='cerco.void_circuit');
 await shot('economy-skins-owned');await page.locator('#pz-skins-back').click();
 await page.locator('#cerco-play-button').click();
 await page.waitForFunction(()=>document.getElementById('cerco-game-frame').contentWindow.CERCO_BRIDGE?.getSkinState().skinId==='cerco.void_circuit');
 await page.evaluate(()=>document.getElementById('cerco-game-frame').contentWindow.location.reload());
 await page.waitForFunction(()=>document.getElementById('cerco-game-frame').contentWindow.CERCO_BRIDGE?.getSkinState().skinId==='cerco.void_circuit');
 await page.reload();await ready();await page.locator('#cerco-play-button').click();
 await page.waitForFunction(()=>document.getElementById('cerco-game-frame').contentWindow.CERCO_BRIDGE?.getSkinState().skinId==='cerco.void_circuit');
 results.push('Economy UI: real purchase after a lost committed response charges once, then persists ownership/equipment through frame and host reloads.');

 // Deterministic fixture exposes existing game functions in memory only.
 await page.route('**/cerco_expedition_v090.html',route=>{
  const html=fs.readFileSync('games/CERCO/cerco_expedition_v090.html','utf8');
  return route.fulfill({contentType:'text/html',body:html.replace('// The release file exposes no developer-only game controls.',
   'window.__coins={state,spawnEnemy,killEnemy,moveTo,blockedIn,finishRun};')});
 });
 await page.evaluate(()=>document.getElementById('cerco-game-frame').contentWindow.location.reload());
 const game=page.frameLocator('#cerco-game-frame');await game.locator('#start').click();
 await page.waitForFunction(()=>!!window.CERCO_SESSION_STATUS().match_id);
 const key=await game.locator('body').evaluate(()=>{
  const h=window.__coins,s=h.state;s.cosmetic.rng=()=>0;s.spawnTimer=999;
  if(!h.spawnEnemy('normal'))throw Error('Fixture enemy unavailable');
  h.killEnemy(s.mobs.find(m=>m.type==='normal'));
  const drop=s.drops.find(d=>d.type==='style_coin');if(!drop)throw Error('Fixture coin unavailable');
  const directions=[[-1,0,'ArrowRight'],[1,0,'ArrowLeft'],[0,-1,'ArrowDown'],[0,1,'ArrowUp']];
  const d=directions.find(([dx,dy])=>!h.blockedIn(s.room,drop.x+dx,drop.y+dy));
  if(!d)throw Error('Coin unreachable');h.moveTo(drop.x+d[0],drop.y+d[1]);return d[2];
 });
 await shot('economy-game-coin-before');
 await game.locator('canvas').first().focus();await page.keyboard.press(key,{delay:180});
 await page.waitForFunction(()=>document.getElementById('cerco-game-frame').contentWindow.CERCO_BRIDGE.getSnapshot().styleCoinsRun>0);
 const match=await page.evaluate(()=>window.CERCO_SESSION_STATUS().match_id);
 await page.waitForFunction(()=>document.getElementById('cosmetic-receipt-status').textContent.startsWith('Coin receipts received.'));
 await shot('economy-game-coin-collected');
 const before=await game.locator('body').evaluate(()=>window.CERCO_BRIDGE.getSnapshot());
 await page.locator('[data-panel="settings"]').click();await ready();
 await page.locator('#pz-skins-grid [data-product-id="cerco.default"] button').first().click();
 await page.waitForFunction(()=>document.getElementById('cerco-game-frame').contentWindow.CERCO_BRIDGE.getSkinState().skinId==='cerco.default');
 const after=await game.locator('body').evaluate(()=>window.CERCO_BRIDGE.getSnapshot());
 for(const field of ['score','kills','credits','health','styleCoinsRun'])assert.equal(after[field],before[field]);
 await page.locator('#pz-skins-back').click();
 await game.locator('body').evaluate(()=>{window.__coins.finishRun();window.__coins.finishRun();});
 await page.waitForFunction(()=>window.CERCO_SESSION_STATUS().report_stored);await ready();
 const session=await db.prepare('SELECT state,amount FROM cosmetic_sessions WHERE match_id=?').bind(match).first();
 assert.equal(session.state,'coherent');assert.ok(session.amount>0);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM cosmetic_receipts WHERE match_id=?').bind(match).first()).n,1);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM pending_run_reports WHERE match_id=?').bind(match).first()).n,1);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM cosmetic_ledger WHERE source_type='reward' AND source_id=?").bind(match).first()).n,0);
 await shot('economy-game-final');
 results.push('Real 0.9.0 movement collects a fixture coin: detailed + pickup events yield one receipt; duplicate final yields one pending report, no credit, no combat changes from skins.');

 // Large values come from the isolated server state, never localStorage overrides.
 await db.prepare('UPDATE cosmetic_wallets SET balance=1000000000 WHERE guest_id=?').bind(g.guest_id).run();
 await refreshWallet();await ready();
 for(const [width,height] of [[1920,1080],[1366,768],[1024,768],[390,844],[844,390]]){
  await page.setViewportSize({width,height});await page.locator('[data-panel="shop"]').click();await ready();
  await shot(`economy-shop-${width}x${height}`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await openWallet();assert.equal(await page.locator('.cosmetic-wallet').evaluate(e=>e.scrollWidth<=e.clientWidth),true);await closeWallet();
  for(const button of await page.locator('#pz-shop-skins button').all()){
   await button.scrollIntoViewIfNeeded();assert.equal(await button.evaluate(e=>{const r=e.getBoundingClientRect();return r.height>=44&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;}),true);
  }
  await page.locator('#pz-shop-back').click();await page.locator('[data-panel="settings"]').click();await ready();
  await shot(`economy-skins-${width}x${height}`);await page.locator('#pz-skins-back').click();
  await openWallet();await shot(`economy-profile-${width}x${height}`);await closeWallet();
  await page.locator('#pz-photo-change').click();assert.equal(await page.locator('#pz-avatar-gallery img').count(),1);
  assert.equal(
    await page.locator('#pz-avatar-gallery .cerco-picture-default img').getAttribute('src'),
    './assets/profile-pictures/Profile_Picture1.png'
  );
  await page.locator('#pz-avatar-modal-close').focus();await page.keyboard.press('Escape');
  assert.equal(await page.locator('#pz-avatar-modal').evaluate(e=>e.open),false);
 }
 await openWallet();await page.locator('#cosmetic-refresh').focus();await page.keyboard.press('Enter');await ready();await closeWallet();
 await page.route('**/shop/catalog',route=>route.abort('failed'));
 await refreshWallet();await page.waitForFunction(()=>window.CERCO_COSMETICS.getStatus()==='error');
 assert.match(await page.locator('#cosmetic-wallet').textContent(),/unavailable/);
 await page.locator('[data-panel="shop"]').click();
 assert.equal(await voidCard.getByRole('button',{name:'UNAVAILABLE',exact:true}).isDisabled(),true);
 await shot('economy-offline');await page.locator('#pz-shop-back').click();
 await game.locator('#again').click();await page.waitForFunction(()=>document.getElementById('cerco-game-frame').contentWindow.CERCO_BRIDGE.getSnapshot().mode==='play');
 results.push('Economy layouts at all five required resolutions: large balance, 44px actions, no horizontal overflow, picture modal, keyboard refresh and gameplay with cosmetics offline.');
 await page.close();
};
