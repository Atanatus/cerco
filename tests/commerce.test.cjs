const {test}=require('node:test');const assert=require('node:assert/strict');
const {setup,fund}=require('./economy-support.cjs');
const key=()=>crypto.randomUUID();
test('commerce/economy writes require exact Origin and server Guest credentials',async t=>{
 const {mf,guest}=await setup(t),g=await guest();
 for(const route of ['/shop/purchase','/skins/purchase','/skins/equip','/profile-picture/equip','/economy/receipts']){
  for(const origin of [null,'https://evil.test']){
   const r=await mf.dispatchFetch('https://local.test'+route,{method:'POST',headers:{Authorization:'Bearer '+g.access_token,
    ...(origin?{Origin:origin}:{}),'Content-Type':'application/json'},body:JSON.stringify({guestId:g.guest_id,productId:'cerco.default',operationKey:key()})});
   assert.equal(r.status,403,route);
  }
  const r=await mf.dispatchFetch('https://local.test'+route,{method:'POST',headers:{Origin:require('./support.cjs').origin,'Content-Type':'application/json'},
   body:JSON.stringify({guestId:g.guest_id,productId:'cerco.void_circuit',operationKey:key()})});
  assert.ok([401,403,503].includes(r.status),'legacy paid-item denial or authenticated route refusal');
 }
 const read=await mf.dispatchFetch('https://local.test/skins/inventory',{headers:{Authorization:'Bearer '+g.access_token}});
 assert.equal(read.status,200,'authenticated native GET without Origin stays compatible');
});
test('commerce: real catalog, server price, idempotent purchase, persistent inventory/equipment and no local entitlement',async t=>{
 const api=await setup(t),{db,call,guest}=api,g=await guest(),other=await guest();
 const buy=body=>call('/shop/purchase',body,g.access_token);
 const cat=await(await call('/shop/catalog',undefined,g.access_token)).json();
 assert.deepEqual(cat.products.map(p=>[p.product_id,p.price]),[['cerco.default',0],['cerco.void_circuit',3000]]);
 assert.equal(cat.categories.find(c=>c.category==='profile_picture').price,1250);
 const req={productId:'cerco.void_circuit',operationKey:key(),price:1,balance:999999,owned:true};
 assert.equal((await buy(req)).status,409);
 assert.equal((await call('/skins/equip',{skinId:req.productId,owned:true},g.access_token)).status,403);
 await fund(api,g,5000);
 const replies=await Promise.all([buy(req),buy(req),buy({...req,operationKey:key()})]);
 assert.ok(replies.every(r=>r.status===200));
 const first=await replies[0].json();assert.ok(first.purchased||first.owned);
 const inv=await(await call('/skins/inventory',undefined,g.access_token)).json();assert.equal(inv.wallet.balance,2000);
 assert.ok(inv.ownedSkinIds.includes(req.productId));
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM cosmetic_purchases').first()).n,1);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM cosmetic_ledger WHERE source_type='purchase'").first()).n,1);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM cosmetic_inventory').first()).n,1);
 const successful=await db.prepare('SELECT operation_key FROM cosmetic_purchases').first();
 assert.equal((await buy({productId:'cerco.default',operationKey:successful.operation_key})).status,409);
 assert.equal((await buy({productId:'does.not.exist',operationKey:key()})).status,409);
 assert.equal((await call('/skins/equip',{skinId:req.productId},other.access_token)).status,403);
 assert.equal((await call('/skins/equip',{skinId:'unknown'},g.access_token)).status,403);
 assert.equal((await call('/skins/equip',{skinId:req.productId},g.access_token)).status,200);
 assert.equal((await(await call('/skins/inventory',undefined,g.access_token)).json()).equippedSkinId,req.productId);
 await db.prepare("UPDATE cosmetic_catalog SET active=0 WHERE product_id='cerco.void_circuit'").run();
 const safe=await(await call('/skins/inventory',undefined,g.access_token)).json();
 assert.equal(safe.equippedSkinId,'cerco.default');assert.ok(safe.ownedSkinIds.includes(req.productId),'inactive item retains legitimate ownership');
 assert.equal((await call('/skins/equip',{skinId:'cerco.default'},g.access_token)).status,200);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('commerce: concurrent products cannot spend the same funds; transaction failure rolls back every effect',async t=>{
 const api=await setup(t),{db,call,guest}=api,g=await guest();await fund(api,g,3000);
 // No real profile picture has been supplied. This row exists only in this isolated test database.
 await db.prepare("INSERT INTO cosmetic_catalog VALUES('test.picture','profile_picture','Test fixture',1250,1,'/assets/test/fixture.png',NULL,0)").run();
 const buy=(productId,operationKey=key())=>call('/shop/purchase',{productId,operationKey},g.access_token);
 await db.prepare("CREATE TRIGGER test_failure BEFORE INSERT ON cosmetic_inventory BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END;").run();
 const retryKey=key();assert.equal((await buy('cerco.void_circuit',retryKey)).status,503);
 assert.equal((await db.prepare('SELECT balance FROM cosmetic_wallets').first()).balance,3000);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM cosmetic_purchases').first()).n,0);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM cosmetic_ledger WHERE source_type='purchase'").first()).n,0);
 await db.prepare('DROP TRIGGER test_failure').run(); // Test-only injected failure, never production.
 const races=await Promise.all([buy('cerco.void_circuit',retryKey),buy('test.picture')]);
 assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM cosmetic_purchases').first()).n,1);
 const w=await db.prepare('SELECT balance FROM cosmetic_wallets').first();assert.ok(w.balance===0||w.balance===1750);
 const owned=await db.prepare('SELECT product_id FROM cosmetic_inventory').first();
 const endpoint=owned.product_id==='test.picture'?'/profile-picture/equip':'/skins/equip';
 assert.equal((await call(endpoint,{productId:owned.product_id},g.access_token)).status,200);
 // Model supports a server grant without retroactively charging for ownership.
 const other=await guest();await db.prepare("INSERT INTO cosmetic_inventory(guest_id,product_id,source) VALUES(?,'test.picture','server_grant')").bind(other.guest_id).run();
 assert.equal((await call('/profile-picture/equip',{productId:'test.picture'},other.access_token)).status,200);
 const granted=await(await call('/shop/purchase',{productId:'test.picture',operationKey:key()},other.access_token)).json();
 assert.equal(granted.owned,true);assert.equal(granted.inventory.wallet.balance,0);
 assert.equal((await(await call('/skins/inventory',undefined,other.access_token)).json()).equippedPictureId,'test.picture');
});
