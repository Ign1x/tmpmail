ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS owner_user_id UUID;

CREATE INDEX IF NOT EXISTS accounts_owner_user_id_idx
    ON accounts (owner_user_id);
