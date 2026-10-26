-- CERCO / OPERATION 30A
-- Server-side session credential hashes.
-- Never store plaintext session credentials here.
-- Never use this table as proof of legitimate gameplay.

CREATE TABLE IF NOT EXISTS match_session_tokens (
    match_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL
        CHECK (length(token_hash) = 64),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(match_id)
);

CREATE INDEX IF NOT EXISTS idx_match_session_tokens_created
    ON match_session_tokens(created_at);