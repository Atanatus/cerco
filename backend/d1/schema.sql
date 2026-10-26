-- CERCO / D1 SCHEMA V0.1
-- Preparacion exclusivamente estructural.
-- Sin autenticacion, sin EXP global, sin puntuaciones oficiales activas.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
    player_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('guest', 'registered')),
    display_name TEXT NOT NULL
        CHECK (length(display_name) BETWEEN 1 AND 24),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    disabled_at TEXT
);

CREATE TABLE IF NOT EXISTS matches (
    match_id TEXT PRIMARY KEY,
    game_version TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created'
        CHECK (status IN (
            'created',
            'active',
            'completed',
            'rejected',
            'abandoned'
        )),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    finished_at TEXT,
    verification_version TEXT,
    rejection_reason TEXT
);

CREATE TABLE IF NOT EXISTS match_participants (
    match_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    seat INTEGER NOT NULL CHECK (seat BETWEEN 1 AND 8),

    PRIMARY KEY (match_id, player_id),
    UNIQUE (match_id, seat),

    FOREIGN KEY (match_id)
        REFERENCES matches(match_id) ON DELETE CASCADE,

    FOREIGN KEY (player_id)
        REFERENCES players(player_id)
);

CREATE TABLE IF NOT EXISTS results (
    result_id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    metric_key TEXT NOT NULL
        CHECK (length(metric_key) BETWEEN 1 AND 48),
    metric_value INTEGER NOT NULL
        CHECK (metric_value >= 0),
    verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (verification_status IN (
            'pending',
            'verified',
            'rejected'
        )),
    verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (match_id, player_id, metric_key),

    FOREIGN KEY (match_id, player_id)
        REFERENCES match_participants(match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_matches_status
    ON matches(status, created_at);

CREATE INDEX IF NOT EXISTS idx_results_ranking
    ON results(
        metric_key,
        verification_status,
        metric_value DESC
    );

CREATE INDEX IF NOT EXISTS idx_results_player
    ON results(player_id, created_at DESC);

-- La vista separa invitados y registrados.
-- Solo incluye resultados previamente verificados.
-- Las reglas definitivas de puntuacion siguen pendientes.

CREATE VIEW IF NOT EXISTS leaderboard_entries AS
SELECT
    p.kind AS leaderboard_kind,
    p.player_id,
    p.display_name,
    r.metric_key,
    MAX(r.metric_value) AS best_value
FROM results r
JOIN players p
    ON p.player_id = r.player_id
JOIN matches m
    ON m.match_id = r.match_id
WHERE r.verification_status = 'verified'
  AND m.status = 'completed'
  AND p.disabled_at IS NULL
GROUP BY
    p.kind,
    p.player_id,
    p.display_name,
    r.metric_key;