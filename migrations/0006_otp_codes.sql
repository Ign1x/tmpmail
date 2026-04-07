CREATE TABLE IF NOT EXISTS otp_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    resend_allowed_at TIMESTAMPTZ NOT NULL,
    failed_attempts SMALLINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS otp_codes_expires_at_idx ON otp_codes (expires_at);
