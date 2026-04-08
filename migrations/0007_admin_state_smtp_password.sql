ALTER TABLE admin_state_store
    ADD COLUMN IF NOT EXISTS smtp_password TEXT;
