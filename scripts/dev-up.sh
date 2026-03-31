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

docker compose -f "$ROOT_DIR/compose.yaml" up --build -d
docker compose -f "$ROOT_DIR/compose.yaml" ps

frontend_port="${TMPMAIL_FRONTEND_PORT:-}"
api_port="${TMPMAIL_PORT:-}"
public_host="${TMPMAIL_PUBLIC_HOST:-}"

if [ -z "$frontend_port" ]; then
  frontend_port="$(env_read TMPMAIL_FRONTEND_PORT "$ENV_FILE" 2>/dev/null || true)"
fi

if [ -z "$api_port" ]; then
  api_port="$(env_read TMPMAIL_PORT "$ENV_FILE" 2>/dev/null || true)"
fi

if [ -z "$public_host" ]; then
  public_host="$(env_read TMPMAIL_PUBLIC_HOST "$ENV_FILE" 2>/dev/null || true)"
fi

if [ -z "$public_host" ]; then
  public_host="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '/src/ {for(i=1;i<=NF;i++) if($i=="src") { print $(i+1); exit }}' || true)"
fi

if [ -z "$public_host" ]; then
  public_host="127.0.0.1"
fi

echo "frontend: http://${public_host}:${frontend_port:-3000}/en"
echo "admin:    http://${public_host}:${frontend_port:-3000}/admin"
echo "api:      http://127.0.0.1:${api_port:-8080}/healthz"
