import {json,economyAccess,bodyOf,wallet} from './economy.js';
import {CURRENCY} from './cosmetic-validation.js';
export async function inventory(db,guest) {
  const owned=(await db.prepare(`SELECT c.product_id,c.category,c.name,c.active,c.asset_path FROM cosmetic_catalog c
   WHERE c.free=1 OR EXISTS(SELECT 1 FROM cosmetic_inventory i WHERE i.guest_id=? AND i.product_id=c.product_id)`)
   .bind(guest.guest_id).all()).results;
  const equipment=(await db.prepare('SELECT category,product_id FROM cosmetic_equipment WHERE guest_id=?').bind(guest.guest_id).all()).results;
  const equipped=category=>equipment.find(e=>e.category===category && owned.some(i=>i.product_id===e.product_id && i.active))?.product_id;
  return {schema:'cerco.inventory.v1',authenticated:true,guest_id:guest.guest_id,display_name:guest.display_name,
    ownedSkinIds:owned.filter(i=>i.category==='game_skin').map(i=>i.product_id),
    equippedSkinId:equipped('game_skin')||'cerco.default',equippedPictureId:equipped('profile_picture')||null,
    items:owned,purchasesAvailable:true,wallet:await wallet(db,guest.guest_id)};
}
async function purchase(db,g,body) {
  const productId=body.productId||body.skinId,key=body.operationKey;
  if(typeof productId!=='string'||productId.length>100||typeof key!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(key))return json({error:'invalid_purchase'},400);
  const previous=await db.prepare('SELECT * FROM cosmetic_purchases WHERE guest_id=? AND operation_key=?').bind(g.guest_id,key).first();
  if(previous){
    if(previous.product_id!==productId)return json({error:'idempotency_conflict'},409);
    return json({purchased:true,purchaseId:previous.purchase_id,inventory:await inventory(db,g)});
  }
  const product=await db.prepare('SELECT * FROM cosmetic_catalog WHERE product_id=?').bind(productId).first();
  if(!product||!product.active)return json({error:'product_unavailable'},409);
  const before=await inventory(db,g);
  if(before.items.some(i=>i.product_id===productId))return json({owned:true,inventory:before});
  const id=crypto.randomUUID();
  // ONE SQL statement, with ledger + ownership triggers in the same transaction.
  // Price and available balance are selected again at the moment of the write.
  await db.prepare(`INSERT INTO cosmetic_purchases(purchase_id,guest_id,operation_key,product_id,amount,currency_id)
   SELECT ?,?,?,c.product_id,c.price,? FROM cosmetic_catalog c JOIN cosmetic_wallets w ON w.guest_id=? AND w.currency_id=?
   WHERE c.product_id=? AND c.active=1 AND c.free=0 AND w.balance>=c.price
    AND NOT EXISTS(SELECT 1 FROM cosmetic_inventory i WHERE i.guest_id=? AND i.product_id=c.product_id)
    AND NOT EXISTS(SELECT 1 FROM cosmetic_purchases p WHERE p.guest_id=? AND p.operation_key=?)`)
   .bind(id,g.guest_id,key,CURRENCY,g.guest_id,CURRENCY,productId,g.guest_id,g.guest_id,key).run();
  const stored=await db.prepare('SELECT * FROM cosmetic_purchases WHERE guest_id=? AND operation_key=?').bind(g.guest_id,key).first();
  if(stored && stored.product_id!==productId)return json({error:'idempotency_conflict'},409);
  const current=await inventory(db,g);
  if(stored)return json({purchased:true,purchaseId:stored.purchase_id,inventory:current});
  if(current.items.some(i=>i.product_id===productId))return json({owned:true,inventory:current});
  return json({error:'insufficient_funds',inventory:current},409);
}
export async function routeCommerce(request,env) {
  try {
    const {guest,error}=await economyAccess(request,env);if(error)return error;
    const path=new URL(request.url).pathname;
    if(request.method==='GET') {
      if(path==='/skins/inventory')return json(await inventory(env.DB,guest));
      if(path==='/shop/catalog')return json({currencyId:CURRENCY,
        categories:(await env.DB.prepare('SELECT category,price FROM cosmetic_categories ORDER BY category').all()).results,
        products:(await env.DB.prepare('SELECT product_id,category,name,price,active,asset_path,free FROM cosmetic_catalog ORDER BY product_id').all()).results,
        inventory:await inventory(env.DB,guest)});
      return json({error:'method_not_allowed'},405);
    }
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    const body=await bodyOf(request,2048);if(body.error)return body.error;
    if(path==='/shop/purchase'||path==='/skins/purchase')return await purchase(env.DB,guest,body.value);
    if(!['/skins/equip','/profile-picture/equip'].includes(path))return json({error:'not_found'},404);
    const category=path==='/skins/equip'?'game_skin':'profile_picture',productId=body.value.skinId||body.value.productId;
    if(typeof productId!=='string'||productId.length>100)return json({error:'invalid_product'},400);
    const owned=await inventory(env.DB,guest);
    if(!owned.items.some(i=>i.product_id===productId&&i.category===category&&i.active))return json({error:'cosmetic_not_owned'},403);
    await env.DB.prepare(`INSERT INTO cosmetic_equipment VALUES(?,?,?)
      ON CONFLICT(guest_id,category) DO UPDATE SET product_id=excluded.product_id`).bind(guest.guest_id,category,productId).run();
    return json({...await inventory(env.DB,guest),cosmeticOnly:true});
  }catch(_){return json({error:'commerce_unavailable'},503);}
}
