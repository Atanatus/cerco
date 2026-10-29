-- Additive only. Guest identities, game reports and official results are reused.
CREATE TABLE IF NOT EXISTS cosmetic_sessions (
 match_id TEXT PRIMARY KEY REFERENCES matches(match_id),
 guest_id TEXT NOT NULL REFERENCES guest_profiles(guest_id),
 run_id TEXT NOT NULL CHECK(length(run_id) BETWEEN 1 AND 150),
 ruleset TEXT NOT NULL CHECK(ruleset='CERCO-0.9.0'),
 policy TEXT NOT NULL DEFAULT 'cerco.cosmetics.v1/0.9.0',
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','coherent','rejected','verified','settled')),
 amount INTEGER NOT NULL DEFAULT 0 CHECK(typeof(amount)='integer' AND amount BETWEEN 0 AND 1000000),
 report_hash TEXT,
 reason TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cosmetic_sessions_guest ON cosmetic_sessions(guest_id,state);
CREATE TABLE IF NOT EXISTS cosmetic_receipts (
 match_id TEXT NOT NULL REFERENCES cosmetic_sessions(match_id),
 drop_id TEXT NOT NULL CHECK(length(drop_id) BETWEEN 1 AND 180),
 spawn_json TEXT,
 receipt_json TEXT,
 spawn_seq INTEGER,
 receipt_seq INTEGER,
 PRIMARY KEY(match_id,drop_id)
);
CREATE TABLE IF NOT EXISTS cosmetic_rate_limits (
 guest_id TEXT PRIMARY KEY REFERENCES guest_profiles(guest_id),
 window_started INTEGER NOT NULL,
 attempts INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trg_cosmetic_receipt_limit BEFORE INSERT ON cosmetic_receipts
WHEN NOT EXISTS(SELECT 1 FROM cosmetic_receipts WHERE match_id=NEW.match_id AND drop_id=NEW.drop_id)
BEGIN
 SELECT RAISE(ABORT,'receipt_limit') WHERE (SELECT COUNT(*) FROM cosmetic_receipts WHERE match_id=NEW.match_id)>=512;
END;
CREATE TRIGGER IF NOT EXISTS trg_cosmetic_receipt_immutable BEFORE UPDATE ON cosmetic_receipts
BEGIN
 SELECT RAISE(ABORT,'receipt_conflict') WHERE
  (OLD.spawn_json IS NOT NULL AND NEW.spawn_json IS NOT OLD.spawn_json) OR
  (OLD.receipt_json IS NOT NULL AND NEW.receipt_json IS NOT OLD.receipt_json) OR
  (OLD.spawn_seq IS NOT NULL AND NEW.spawn_seq IS NOT OLD.spawn_seq) OR
  (OLD.receipt_seq IS NOT NULL AND NEW.receipt_seq IS NOT OLD.receipt_seq);
END;
CREATE TABLE IF NOT EXISTS cosmetic_wallets (
 guest_id TEXT NOT NULL REFERENCES guest_profiles(guest_id),
 currency_id TEXT NOT NULL CHECK(currency_id='atanatus.style_coins'),
 balance INTEGER NOT NULL DEFAULT 0 CHECK(typeof(balance)='integer' AND balance BETWEEN 0 AND 1000000000),
 earned INTEGER NOT NULL DEFAULT 0 CHECK(typeof(earned)='integer' AND earned BETWEEN 0 AND 9007199254740991),
 PRIMARY KEY(guest_id,currency_id)
);
-- No HTTP API populates this table. A future reviewed independent authority is required.
CREATE TABLE IF NOT EXISTS cosmetic_authorizations (
 match_id TEXT PRIMARY KEY REFERENCES cosmetic_sessions(match_id),
 report_hash TEXT NOT NULL CHECK(length(report_hash)=64),
 amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 0 AND 1000000),
 authority TEXT NOT NULL CHECK(length(authority) BETWEEN 1 AND 100),
 evidence_ref TEXT NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 200),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cosmetic_ledger (
 entry_id TEXT PRIMARY KEY,
 guest_id TEXT NOT NULL REFERENCES guest_profiles(guest_id),
 currency_id TEXT NOT NULL CHECK(currency_id='atanatus.style_coins'),
 delta INTEGER NOT NULL CHECK(typeof(delta)='integer' AND delta BETWEEN -1000000 AND 1000000 AND delta<>0),
 source_type TEXT NOT NULL CHECK(source_type IN('reward','purchase')),
 source_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(source_type,source_id),
 CHECK((source_type='reward' AND delta>0) OR (source_type='purchase' AND delta<0))
);
CREATE INDEX IF NOT EXISTS idx_cosmetic_ledger_guest ON cosmetic_ledger(guest_id,created_at);
CREATE TRIGGER IF NOT EXISTS trg_cosmetic_reward_authority
BEFORE INSERT ON cosmetic_ledger WHEN NEW.source_type='reward'
BEGIN
 SELECT RAISE(ABORT,'reward_not_authorized') WHERE NOT EXISTS (
  SELECT 1 FROM cosmetic_sessions s JOIN cosmetic_authorizations a ON a.match_id=s.match_id
  JOIN matches m ON m.match_id=s.match_id
  WHERE s.match_id=NEW.source_id AND s.guest_id=NEW.guest_id AND m.guest_id=s.guest_id
   AND m.status='completed' AND s.state='verified' AND a.report_hash=s.report_hash
   AND a.amount=s.amount AND s.amount=NEW.delta
 );
END;
CREATE TRIGGER IF NOT EXISTS trg_cosmetic_ledger_apply
AFTER INSERT ON cosmetic_ledger
BEGIN
 INSERT INTO cosmetic_wallets(guest_id,currency_id,balance,earned)
 VALUES(NEW.guest_id,NEW.currency_id,0,0) ON CONFLICT(guest_id,currency_id) DO NOTHING;
 UPDATE cosmetic_wallets SET balance=balance+NEW.delta, earned=earned+MAX(NEW.delta,0)
 WHERE guest_id=NEW.guest_id AND currency_id=NEW.currency_id;
 UPDATE cosmetic_sessions SET state='settled' WHERE match_id=NEW.source_id AND NEW.source_type='reward';
END;
CREATE TRIGGER IF NOT EXISTS trg_cosmetic_ledger_no_update BEFORE UPDATE ON cosmetic_ledger
BEGIN SELECT RAISE(ABORT,'immutable_ledger'); END;
CREATE TRIGGER IF NOT EXISTS trg_cosmetic_ledger_no_delete BEFORE DELETE ON cosmetic_ledger
BEGIN SELECT RAISE(ABORT,'immutable_ledger'); END;
