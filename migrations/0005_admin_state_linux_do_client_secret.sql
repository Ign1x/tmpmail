ALTER TABLE admin_state_store
    ADD COLUMN IF NOT EXISTS linux_do_client_secret TEXT;
