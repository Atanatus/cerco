-- DIR044: independent rule contract for CERCO 0.9.12.
ALTER TABLE matches ADD COLUMN ruleset TEXT;
ALTER TABLE matches ADD COLUMN client_run_id TEXT;
