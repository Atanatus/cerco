CREATE TABLE IF NOT EXISTS cosmetic_categories (
 category TEXT PRIMARY KEY CHECK(category IN('game_skin','profile_picture')),
 price INTEGER NOT NULL CHECK(typeof(price)='integer' AND price>0)
);
INSERT INTO cosmetic_categories VALUES('game_skin',3000),('profile_picture',1250) ON CONFLICT(category) DO NOTHING;
CREATE TABLE IF NOT EXISTS cosmetic_catalog (
 product_id TEXT PRIMARY KEY,
 category TEXT NOT NULL REFERENCES cosmetic_categories(category),
 name TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(typeof(price)='integer' AND price BETWEEN 0 AND 1000000),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 asset_path TEXT NOT NULL,
 game_id TEXT,
 free INTEGER NOT NULL DEFAULT 0 CHECK(free IN(0,1)),
 CHECK((free=0 AND price>0) OR (free=1 AND price=0 AND product_id='cerco.default'))
);
INSERT INTO cosmetic_catalog VALUES
 ('cerco.default','game_skin','Original',0,1,'/assets/skins/cerco/cerco_skin_original.png','CERCO',1),
 ('cerco.void_circuit','game_skin','Void Circuit',3000,1,'/assets/skins/cerco/cerco_skin_void_circuit.png','CERCO',0)
 ON CONFLICT(product_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS cosmetic_purchases (
 purchase_id TEXT PRIMARY KEY,
 guest_id TEXT NOT NULL REFERENCES guest_profiles(guest_id),
 operation_key TEXT NOT NULL CHECK(length(operation_key) BETWEEN 16 AND 80),
 product_id TEXT NOT NULL REFERENCES cosmetic_catalog(product_id),
 amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),
 currency_id TEXT NOT NULL CHECK(currency_id='atanatus.style_coins'),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(guest_id,operation_key), UNIQUE(guest_id,product_id)
);
CREATE TABLE IF NOT EXISTS cosmetic_inventory (
 guest_id TEXT NOT NULL REFERENCES guest_profiles(guest_id),
 product_id TEXT NOT NULL REFERENCES cosmetic_catalog(product_id),
 purchase_id TEXT UNIQUE REFERENCES cosmetic_purchases(purchase_id),
 source TEXT NOT NULL CHECK(source IN('purchase','server_grant')),
 acquired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(guest_id,product_id)
);
CREATE TABLE IF NOT EXISTS cosmetic_equipment (
 guest_id TEXT NOT NULL REFERENCES guest_profiles(guest_id),
 category TEXT NOT NULL REFERENCES cosmetic_categories(category),
 product_id TEXT NOT NULL REFERENCES cosmetic_catalog(product_id),
 PRIMARY KEY(guest_id,category)
);
CREATE TRIGGER IF NOT EXISTS trg_cosmetic_purchase_guard BEFORE INSERT ON cosmetic_purchases
BEGIN
 SELECT RAISE(ABORT,'invalid_purchase') WHERE NOT EXISTS(
  SELECT 1 FROM cosmetic_catalog c JOIN cosmetic_wallets w ON w.guest_id=NEW.guest_id AND w.currency_id=NEW.currency_id
  WHERE c.product_id=NEW.product_id AND c.price=NEW.amount AND c.active=1 AND c.free=0
   AND w.balance>=NEW.amount AND NOT EXISTS(SELECT 1 FROM cosmetic_inventory i WHERE i.guest_id=NEW.guest_id AND i.product_id=NEW.product_id)
 );
END;
CREATE TRIGGER IF NOT EXISTS trg_cosmetic_purchase_apply AFTER INSERT ON cosmetic_purchases
BEGIN
 INSERT INTO cosmetic_ledger(entry_id,guest_id,currency_id,delta,source_type,source_id)
 VALUES(NEW.purchase_id,NEW.guest_id,NEW.currency_id,-NEW.amount,'purchase',NEW.purchase_id);
 INSERT INTO cosmetic_inventory(guest_id,product_id,purchase_id,source)
 VALUES(NEW.guest_id,NEW.product_id,NEW.purchase_id,'purchase');
END;
CREATE TRIGGER IF NOT EXISTS trg_cosmetic_purchase_ledger BEFORE INSERT ON cosmetic_ledger WHEN NEW.source_type='purchase'
BEGIN
 SELECT RAISE(ABORT,'purchase_not_authorized') WHERE NOT EXISTS(
  SELECT 1 FROM cosmetic_purchases p WHERE p.purchase_id=NEW.source_id AND p.guest_id=NEW.guest_id
   AND p.currency_id=NEW.currency_id AND p.amount=-NEW.delta
 );
END;
CREATE TRIGGER IF NOT EXISTS trg_cosmetic_purchases_no_update BEFORE UPDATE ON cosmetic_purchases
BEGIN SELECT RAISE(ABORT,'immutable_purchase'); END;
CREATE TRIGGER IF NOT EXISTS trg_cosmetic_purchases_no_delete BEFORE DELETE ON cosmetic_purchases
BEGIN SELECT RAISE(ABORT,'immutable_purchase'); END;
CREATE TRIGGER IF NOT EXISTS trg_cosmetic_equipment_insert BEFORE INSERT ON cosmetic_equipment
BEGIN
 SELECT RAISE(ABORT,'cosmetic_not_owned') WHERE NOT EXISTS(
  SELECT 1 FROM cosmetic_catalog c WHERE c.product_id=NEW.product_id AND c.category=NEW.category AND c.active=1
   AND (c.free=1 OR EXISTS(SELECT 1 FROM cosmetic_inventory i WHERE i.guest_id=NEW.guest_id AND i.product_id=c.product_id))
 );
END;
CREATE TRIGGER IF NOT EXISTS trg_cosmetic_equipment_update BEFORE UPDATE ON cosmetic_equipment
BEGIN
 SELECT RAISE(ABORT,'cosmetic_not_owned') WHERE NOT EXISTS(
  SELECT 1 FROM cosmetic_catalog c WHERE c.product_id=NEW.product_id AND c.category=NEW.category AND c.active=1
   AND (c.free=1 OR EXISTS(SELECT 1 FROM cosmetic_inventory i WHERE i.guest_id=NEW.guest_id AND i.product_id=c.product_id))
 );
END;
