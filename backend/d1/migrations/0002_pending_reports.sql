-- CERCO / PENDING REPORTS V1
-- Client-reported telemetry. Never authoritative.
-- This table does not feed the official leaderboard.

CREATE TABLE IF NOT EXISTS pending_run_reports (
    report_id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL,
    guest_id TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 1000000000),
    kills INTEGER NOT NULL CHECK (kills BETWEEN 0 AND 100000000),
    room INTEGER NOT NULL CHECK (room BETWEEN 1 AND 100000),
    seed INTEGER NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
    active_seconds REAL NOT NULL CHECK (
        active_seconds >= 0 AND active_seconds <= 864000
    ),
    audit_json TEXT NOT NULL CHECK (
        length(audit_json) BETWEEN 2 AND 131072
    ),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'rejected', 'reviewed')),
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (match_id)
        REFERENCES matches(match_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_reports_status
    ON pending_run_reports(status, received_at);

CREATE INDEX IF NOT EXISTS idx_pending_reports_guest
    ON pending_run_reports(guest_id, received_at);