ALTER TABLE admin_state_store
    ADD COLUMN IF NOT EXISTS cloudflare_tokens JSONB NOT NULL DEFAULT '{}'::jsonb;
