#!/bin/sh

set -eu

SECRET_DIR="${TMPMAIL_SECRET_DIR:-/run/tmpmail-secrets}"
POSTGRES_DATA_DIR="${TMPMAIL_POSTGRES_DATA_DIR:-/var/lib/postgresql/data}"
JWT_SECRET_FILE="${SECRET_DIR}/jwt_secret"
POSTGRES_PASSWORD_FILE="${SECRET_DIR}/postgres_password"

log() {
  printf '%s\n' "$*"
}

generate_secret() {
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48
}

seed_or_reuse_secret() {
  label="$1"
  file_path="$2"
  configured_value="$3"
  allow_generate="$4"

  if [ -s "$file_path" ]; then
    existing_value="$(cat "$file_path")"
    if [ -n "$configured_value" ] && [ "$configured_value" != "$existing_value" ]; then
      log "warning: ignoring $label from environment because persisted secret already exists at $file_path"
    else
      log "reusing $label from $file_path"
    fi
    return 0
  fi

  if [ -n "$configured_value" ]; then
    printf '%s' "$configured_value" >"$file_path"
    chmod 0644 "$file_path"
    log "seeded $label from environment into $file_path"
    return 0
  fi

  if [ "$allow_generate" != "true" ]; then
    log "error: missing persisted $label at $file_path while existing PostgreSQL data was detected in $POSTGRES_DATA_DIR"
    log "error: restore the original secret file or set $label in .env to the original value before retrying"
    return 1
  fi

  generated_value="$(generate_secret)"
  printf '%s' "$generated_value" >"$file_path"
  chmod 0644 "$file_path"
  log "generated $label=$generated_value"
  log "stored $label at $file_path"
}

mkdir -p "$SECRET_DIR"

postgres_data_initialized="false"
if [ -s "${POSTGRES_DATA_DIR}/PG_VERSION" ]; then
  postgres_data_initialized="true"
fi

seed_or_reuse_secret "TMPMAIL_JWT_SECRET" "$JWT_SECRET_FILE" "${TMPMAIL_JWT_SECRET:-}" "true"

postgres_allow_generate="true"
if [ "$postgres_data_initialized" = "true" ]; then
  postgres_allow_generate="false"
fi

seed_or_reuse_secret \
  "TMPMAIL_POSTGRES_PASSWORD" \
  "$POSTGRES_PASSWORD_FILE" \
  "${TMPMAIL_POSTGRES_PASSWORD:-}" \
  "$postgres_allow_generate"

log "generated secrets are sensitive; limit access to docker logs and ${SECRET_DIR}"
