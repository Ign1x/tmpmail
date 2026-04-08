#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
# shellcheck source=./lib/env.sh
. "$ROOT_DIR/scripts/lib/env.sh"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  echo "created $ENV_FILE from .env.example"
fi

trim_whitespace() {
  local value="$1"

  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"

  printf '%s' "$value"
}

env_upsert() {
  local key="$1"
  local value="$2"
  local env_dir
  local tmp_file

  env_dir="$(dirname "$ENV_FILE")"
  tmp_file="$(mktemp "$env_dir/.env.tmp.XXXXXX")"

  if [ -f "$ENV_FILE" ]; then
    awk -v key="$key" -v value="$value" '
      BEGIN { updated = 0 }
      index($0, key "=") == 1 && updated == 0 {
        print key "=" value
        updated = 1
        next
      }
      { print }
      END {
        if (updated == 0) {
          print key "=" value
        }
      }
    ' "$ENV_FILE" >"$tmp_file"
  else
    printf '%s=%s\n' "$key" "$value" >"$tmp_file"
  fi

  mv "$tmp_file" "$ENV_FILE"
}

ensure_interactive_prompt() {
  if [ ! -t 0 ]; then
    echo "error: ${ENV_FILE} is missing required values and stdin is not interactive"
    echo "fill TMPMAIL_ADMIN_PASSWORD and TMPMAIL_MAIL_EXCHANGE_HOST in ${ENV_FILE}, or rerun ./scripts/dev-up.sh in a terminal"
    exit 1
  fi
}

valid_admin_password() {
  local value="$1"
  [ "${#value}" -ge 10 ]
}

valid_mail_exchange_host() {
  local value="$1"

  if [ -z "$value" ]; then
    return 1
  fi

  case "$value" in
    *://*|*/*|*:*|*[\ \	]*)
      return 1
      ;;
  esac

  case "$value" in
    *.*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

prompt_admin_password() {
  local password
  local confirm

  ensure_interactive_prompt

  while true; do
    read -r -s -p "TMPMAIL_ADMIN_PASSWORD (at least 10 chars): " password
    printf '\n'

    if ! valid_admin_password "$password"; then
      echo "password is too short"
      continue
    fi

    read -r -s -p "Confirm TMPMAIL_ADMIN_PASSWORD: " confirm
    printf '\n'

    if [ "$password" != "$confirm" ]; then
      echo "passwords did not match"
      continue
    fi

    printf '%s' "$password"
    return 0
  done
}

prompt_mail_exchange_host() {
  local value

  ensure_interactive_prompt

  while true; do
    read -r -p "TMPMAIL_MAIL_EXCHANGE_HOST (example: mail.example.com): " value
    value="$(trim_whitespace "$value")"

    if ! valid_mail_exchange_host "$value"; then
      echo "enter a hostname only, for example mail.example.com"
      continue
    fi

    printf '%s' "$value"
    return 0
  done
}

admin_password="${TMPMAIL_ADMIN_PASSWORD:-}"
if [ -z "$admin_password" ]; then
  admin_password="$(env_read TMPMAIL_ADMIN_PASSWORD "$ENV_FILE" 2>/dev/null || true)"
fi
admin_password="$(trim_whitespace "$admin_password")"
if ! valid_admin_password "$admin_password"; then
  if [ -n "$admin_password" ]; then
    echo "TMPMAIL_ADMIN_PASSWORD in ${ENV_FILE} is missing or shorter than 10 characters"
  fi
  admin_password="$(prompt_admin_password)"
fi
env_upsert "TMPMAIL_ADMIN_PASSWORD" "$admin_password"

mail_exchange_host="${TMPMAIL_MAIL_EXCHANGE_HOST:-}"
if [ -z "$mail_exchange_host" ]; then
  mail_exchange_host="$(env_read TMPMAIL_MAIL_EXCHANGE_HOST "$ENV_FILE" 2>/dev/null || true)"
fi
mail_exchange_host="$(trim_whitespace "$mail_exchange_host")"
if ! valid_mail_exchange_host "$mail_exchange_host"; then
  if [ -n "$mail_exchange_host" ]; then
    echo "TMPMAIL_MAIL_EXCHANGE_HOST in ${ENV_FILE} is invalid"
  fi
  mail_exchange_host="$(prompt_mail_exchange_host)"
fi
env_upsert "TMPMAIL_MAIL_EXCHANGE_HOST" "$mail_exchange_host"

echo "saved required deployment values to ${ENV_FILE}"

docker compose -f "$ROOT_DIR/compose.yaml" up --build -d
docker compose -f "$ROOT_DIR/compose.yaml" ps

frontend_port="${TMPMAIL_FRONTEND_PORT:-}"
api_port="${TMPMAIL_PORT:-}"
public_host="${TMPMAIL_PUBLIC_HOST:-}"
mail_exchange_priority="${TMPMAIL_MAIL_EXCHANGE_PRIORITY:-}"
domain_txt_prefix="${TMPMAIL_DOMAIN_TXT_PREFIX:-}"
admin_entry_path="${TMPMAIL_ADMIN_ENTRY_PATH:-}"

if [ -z "$frontend_port" ]; then
  frontend_port="$(env_read TMPMAIL_FRONTEND_PORT "$ENV_FILE" 2>/dev/null || true)"
fi

if [ -z "$api_port" ]; then
  api_port="$(env_read TMPMAIL_PORT "$ENV_FILE" 2>/dev/null || true)"
fi

if [ -z "$public_host" ]; then
  public_host="$(env_read TMPMAIL_PUBLIC_HOST "$ENV_FILE" 2>/dev/null || true)"
fi

if [ -z "$mail_exchange_priority" ]; then
  mail_exchange_priority="$(env_read TMPMAIL_MAIL_EXCHANGE_PRIORITY "$ENV_FILE" 2>/dev/null || true)"
fi

if [ -z "$domain_txt_prefix" ]; then
  domain_txt_prefix="$(env_read TMPMAIL_DOMAIN_TXT_PREFIX "$ENV_FILE" 2>/dev/null || true)"
fi

if [ -z "$admin_entry_path" ]; then
  admin_entry_path="$(env_read TMPMAIL_ADMIN_ENTRY_PATH "$ENV_FILE" 2>/dev/null || true)"
fi

if [ -z "$public_host" ]; then
  public_host="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '/src/ {for(i=1;i<=NF;i++) if($i=="src") { print $(i+1); exit }}' || true)"
fi

if [ -z "$public_host" ]; then
  public_host="127.0.0.1"
fi

if [ -z "$mail_exchange_priority" ]; then
  mail_exchange_priority="10"
fi

if [ -z "$admin_entry_path" ]; then
  admin_entry_path="/admin"
fi

txt_record_name="<domain>"
if [ -n "$domain_txt_prefix" ] && [ "$domain_txt_prefix" != "@" ]; then
  txt_record_name="${domain_txt_prefix}.<domain>"
fi

echo "frontend: http://${public_host}:${frontend_port:-3000}/en"
echo "admin:    http://${public_host}:${frontend_port:-3000}${admin_entry_path}"
echo "api:      http://127.0.0.1:${api_port:-8080}/healthz"

printf '\n== Next step: DNS / Cloudflare ==\n'
if [ -n "$mail_exchange_host" ]; then
  echo "1. Create a DNS-only A/AAAA record for ${mail_exchange_host} that points to this server's public IP."
  echo "2. Open the admin console and add each managed domain."
  echo "3. For each managed domain, add the DNS records shown in the admin UI:"
  echo "   - CNAME mail.<domain> -> ${mail_exchange_host}"
  echo "   - MX    <domain> -> ${mail_exchange_priority} ${mail_exchange_host}"
  echo "   - TXT   ${txt_record_name} -> <verification token from admin UI>"
  echo "4. Optional: save a Cloudflare API token with Zone:Read and DNS:Edit to enable automatic DNS sync."
else
  echo "TMPMAIL_MAIL_EXCHANGE_HOST is empty."
  echo "Set it in ${ENV_FILE} to a stable public MX hostname such as mail.example.com, then rerun this command."
fi
