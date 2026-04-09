ALTER TABLE domains
    ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE domains
SET is_shared = TRUE
WHERE owner_user_id IS NULL;

CREATE INDEX IF NOT EXISTS domains_shared_status_idx
    ON domains (is_shared, status, is_verified);
