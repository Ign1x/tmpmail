CREATE TABLE IF NOT EXISTS domains (
    id UUID PRIMARY KEY,
    domain TEXT NOT NULL UNIQUE,
    is_verified BOOLEAN NOT NULL,
    status TEXT NOT NULL,
    verification_token TEXT,
    verification_error TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS domains_status_idx ON domains (status);

CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY,
    address TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    quota BIGINT NOT NULL,
    is_disabled BOOLEAN NOT NULL,
    is_deleted BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_address_active_idx
    ON accounts (address)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS accounts_expiry_idx ON accounts (expires_at);

CREATE TABLE IF NOT EXISTS imported_source_keys (
    source_key TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    source_key TEXT,
    msgid TEXT NOT NULL,
    from_address JSONB NOT NULL,
    to_addresses JSONB NOT NULL,
    subject TEXT NOT NULL,
    intro TEXT NOT NULL,
    seen BOOLEAN NOT NULL,
    is_deleted BOOLEAN NOT NULL,
    has_attachments BOOLEAN NOT NULL,
    size BIGINT NOT NULL,
    download_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    text_content TEXT NOT NULL,
    html_parts JSONB NOT NULL,
    attachments JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_account_created_idx
    ON messages (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS messages_source_key_idx ON messages (source_key);

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    entry TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_idx
    ON audit_logs (created_at DESC, id DESC);
