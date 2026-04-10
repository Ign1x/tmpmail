#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
# shellcheck source=./lib/env.sh
. "$ROOT_DIR/scripts/lib/env.sh"

tmpmail_port="${TMPMAIL_PORT:-}"
frontend_port="${TMPMAIL_FRONTEND_PORT:-}"
smoke_address="${TMPMAIL_SMOKE_ADDRESS:-}"
smoke_password="${TMPMAIL_SMOKE_PASSWORD:-}"

if [ -z "$tmpmail_port" ]; then
  tmpmail_port="$(env_read TMPMAIL_PORT "$ENV_FILE" 2>/dev/null || true)"
fi

if [ -z "$frontend_port" ]; then
  frontend_port="$(env_read TMPMAIL_FRONTEND_PORT "$ENV_FILE" 2>/dev/null || true)"
fi

if [ -z "$smoke_address" ]; then
  smoke_address="$(env_read TMPMAIL_SMOKE_ADDRESS "$ENV_FILE" 2>/dev/null || true)"
fi

if [ -z "$smoke_password" ]; then
  smoke_password="$(env_read TMPMAIL_SMOKE_PASSWORD "$ENV_FILE" 2>/dev/null || true)"
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required"
  exit 1
fi

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:${tmpmail_port:-8080}}"
FRONTEND_BASE_URL="${FRONTEND_BASE_URL:-http://127.0.0.1:${frontend_port:-3000}}"
SMOKE_SKIP_FRONTEND="${SMOKE_SKIP_FRONTEND:-0}"
SMOKE_ADDRESS="${smoke_address:-}"
SMOKE_PASSWORD="${smoke_password:-123456}"
SMOKE_ACCOUNT_GENERATED=0
SMOKE_GENERATED_ACCOUNT_ID=""
SMOKE_GENERATED_TOKEN=""

cleanup_generated_account() {
  if [ "$SMOKE_ACCOUNT_GENERATED" != "1" ]; then
    return
  fi

  if [ -z "$SMOKE_GENERATED_ACCOUNT_ID" ] || [ -z "$SMOKE_GENERATED_TOKEN" ]; then
    return
  fi

  curl -sS -o /dev/null -X DELETE \
    "$API_BASE_URL/accounts/$SMOKE_GENERATED_ACCOUNT_ID" \
    -H "Authorization: Bearer $SMOKE_GENERATED_TOKEN" || true
}

trap cleanup_generated_account EXIT

if [ -z "$SMOKE_ADDRESS" ]; then
  public_domains="$(curl -fsS "$API_BASE_URL/domains")"
  public_domain="$(
    printf '%s' "$public_domains" | jq -r '."hydra:member"[0].domain // empty'
  )"

  if [ -z "$public_domain" ]; then
    echo "SMOKE_ADDRESS is required because /domains returned no public domains."
    echo "Set TMPMAIL_SMOKE_ADDRESS to an active mailbox address, or expose at least one public managed domain."
    exit 1
  fi

  SMOKE_ADDRESS="smoke-$(date +%s)@$public_domain"
  SMOKE_ACCOUNT_GENERATED=1
fi

echo "API_BASE_URL=$API_BASE_URL"
echo "FRONTEND_BASE_URL=$FRONTEND_BASE_URL"
echo "SMOKE_ADDRESS=$SMOKE_ADDRESS"

health="$(curl -fsS "$API_BASE_URL/healthz")"
ready="$(curl -fsS "$API_BASE_URL/readyz")"
account_payload="$(mktemp)"
account_status="$(
  curl -sS -o "$account_payload" -w '%{http_code}' -X POST "$API_BASE_URL/accounts" \
    -H 'Content-Type: application/json' \
    -d "{\"address\":\"$SMOKE_ADDRESS\",\"password\":\"$SMOKE_PASSWORD\"}"
)"
account="$(cat "$account_payload")"
rm -f "$account_payload"

if [ "$account_status" = "201" ]; then
  :
elif [ "$SMOKE_ACCOUNT_GENERATED" = "1" ]; then
  echo "generated account create failed: $account"
  exit 1
elif [ "$account_status" = "422" ] && printf '%s' "$account" | grep -Eq 'Email address already exists|already exists|already used'; then
  account="{\"status\":\"existing\",\"address\":\"$SMOKE_ADDRESS\"}"
else
  echo "account create failed: $account"
  exit 1
fi

if [ "$SMOKE_ACCOUNT_GENERATED" = "1" ]; then
  SMOKE_GENERATED_ACCOUNT_ID="$(
    printf '%s' "$account" | jq -r '.id // empty'
  )"
fi

token="$(
  curl -fsS -X POST "$API_BASE_URL/token" \
    -H 'Content-Type: application/json' \
    -d "{\"address\":\"$SMOKE_ADDRESS\",\"password\":\"$SMOKE_PASSWORD\"}" \
    | jq -r '.token'
)"

if [ "$SMOKE_ACCOUNT_GENERATED" = "1" ]; then
  SMOKE_GENERATED_TOKEN="$token"
fi

me="$(curl -fsS "$API_BASE_URL/me" -H "Authorization: Bearer $token")"
messages="$(curl -fsS "$API_BASE_URL/messages?page=1" -H "Authorization: Bearer $token")"
first_message_id="$(printf '%s' "$messages" | jq -r '."hydra:member"[0].id // empty')"
raw_http="skipped"
if [ -n "$first_message_id" ]; then
  raw_http="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      "$API_BASE_URL/messages/$first_message_id/raw" \
      -H "Authorization: Bearer $token"
  )"
fi
frontend_http="skipped"

if [ "$SMOKE_SKIP_FRONTEND" != "1" ]; then
  frontend_http="$(curl -fsS -o /dev/null -w '%{http_code}' "$FRONTEND_BASE_URL/en")"
fi

printf 'HEALTH=%s\nREADY=%s\nACCOUNT=%s\nME=%s\nMESSAGES=%s\nRAW_HTTP=%s\nFRONTEND_HTTP=%s\n' \
  "$health" "$ready" "$account" "$me" "$messages" "$raw_http" "$frontend_http"
