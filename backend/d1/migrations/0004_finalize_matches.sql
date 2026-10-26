-- CERCO / OPERATION 31A
-- Match lifecycle is independent of score verification.
-- Reports remain unverified and cannot enter official rankings.
-- SQLite executes the trigger within the INSERT transaction.

CREATE TRIGGER IF NOT EXISTS trg_cerco_close_match_on_pending
AFTER INSERT ON pending_run_reports
FOR EACH ROW
BEGIN
    UPDATE matches
    SET status = 'completed',
        finished_at = COALESCE(finished_at, NEW.received_at)
    WHERE match_id = NEW.match_id
      AND status = 'active';
END;

-- Reconcile previously accepted reports.
-- Never change the report's verification status.
-- Never create official results.

UPDATE matches
SET status = 'completed',
    finished_at = COALESCE(
        finished_at,
        (
            SELECT p.received_at
            FROM pending_run_reports p
            WHERE p.match_id = matches.match_id
        )
    )
WHERE status = 'active'
  AND EXISTS (
      SELECT 1
      FROM pending_run_reports p
      WHERE p.match_id = matches.match_id
  );