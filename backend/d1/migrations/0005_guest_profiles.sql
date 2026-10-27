-- Persistent server-issued guest identities. Credentials are stored only as hashes.
CREATE TABLE IF NOT EXISTS guest_profiles (
    guest_id TEXT PRIMARY KEY,
    recovery_token_hash TEXT NOT NULL UNIQUE CHECK (length(recovery_token_hash) = 64),
    display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 14 AND 18),
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guest_access_tokens (
    token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
    guest_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (guest_id) REFERENCES guest_profiles(guest_id)
);

CREATE INDEX IF NOT EXISTS idx_guest_access_guest_expiry
    ON guest_access_tokens(guest_id, expires_at);

CREATE TABLE IF NOT EXISTS guest_profile_rate_limits (
    ip_hash TEXT PRIMARY KEY CHECK (length(ip_hash) = 64),
    window_started_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guest_profile_rate_seen
    ON guest_profile_rate_limits(last_seen_at);

ALTER TABLE matches ADD COLUMN guest_id TEXT REFERENCES guest_profiles(guest_id);

CREATE INDEX IF NOT EXISTS idx_matches_guest
    ON matches(guest_id, started_at);
