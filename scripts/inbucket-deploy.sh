#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/inbucket-deploy.sh [render|up|down|logs|ps] [options]

Options:
  --output DIR           Output directory. Default: current directory
  --image IMAGE          Inbucket image. Default: inbucket/inbucket:latest
  --name NAME            Container name. Default: tmpmail-inbucket
  --web-port PORT        Web UI port. Default: 9000
  --smtp-port PORT       SMTP port. Default: 2500
  --pop3-port PORT       POP3 port. Default: 1100
  --smtp-domain DOMAIN   SMTP banner domain. Required
  --retention PERIOD     Retention period. Default: 168h
  --mailbox-cap N        Mailbox message cap. Default: 2000
  --loglevel LEVEL       Log level. Default: info
  --force                Overwrite existing compose.yml and .env
  -h, --help             Show this help

Examples:
  ./scripts/inbucket-deploy.sh render
  ./scripts/inbucket-deploy.sh up --smtp-domain mail.your-domain.tld
EOF
}

mode="render"
if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
  mode="$1"
  shift
fi

output_dir="${OUTPUT_DIR:-$PWD}"
image="${INBUCKET_IMAGE:-inbucket/inbucket:latest}"
container_name="${INBUCKET_CONTAINER_NAME:-tmpmail-inbucket}"
web_port="${INBUCKET_WEB_PORT:-9000}"
smtp_port="${INBUCKET_SMTP_PORT:-2500}"
pop3_port="${INBUCKET_POP3_PORT:-1100}"
retention_period="${INBUCKET_STORAGE_RETENTIONPERIOD:-168h}"
mailbox_cap="${INBUCKET_STORAGE_MAILBOXMSGCAP:-2000}"
loglevel="${INBUCKET_LOGLEVEL:-info}"
smtp_domain="${INBUCKET_SMTP_DOMAIN:-}"
force="false"

while [ $# -gt 0 ]; do
  case "$1" in
    --output)
      output_dir="$2"
      shift 2
      ;;
    --image)
      image="$2"
      shift 2
      ;;
    --name)
      container_name="$2"
      shift 2
      ;;
    --web-port)
      web_port="$2"
      shift 2
      ;;
    --smtp-port)
      smtp_port="$2"
      shift 2
      ;;
    --pop3-port)
      pop3_port="$2"
      shift 2
      ;;
    --smtp-domain)
      smtp_domain="$2"
      shift 2
      ;;
    --retention)
      retention_period="$2"
      shift 2
      ;;
    --mailbox-cap)
      mailbox_cap="$2"
      shift 2
      ;;
    --loglevel)
      loglevel="$2"
      shift 2
      ;;
    --force)
      force="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -z "$smtp_domain" ]; then
  echo "--smtp-domain is required" >&2
  usage >&2
  exit 1
fi

case "$mode" in
  render|up|down|logs|ps)
    ;;
  *)
    echo "unknown mode: $mode" >&2
    usage >&2
    exit 1
    ;;
esac

env_file="$output_dir/inbucket.env"
data_dir="$output_dir/inbucket-data"
data_basename="$(basename "$data_dir")"
compose_file="$output_dir/inbucket.compose.yml"

render_bundle() {
  mkdir -p "$data_dir/config" "$data_dir/storage"

  if [ "$force" != "true" ]; then
    if [ -f "$compose_file" ] || [ -f "$env_file" ]; then
      echo "target files already exist in $output_dir; rerun with --force to overwrite" >&2
      exit 1
    fi
  fi

  cat >"$env_file" <<EOF
INBUCKET_IMAGE=$image
INBUCKET_CONTAINER_NAME=$container_name
INBUCKET_WEB_PORT=$web_port
INBUCKET_SMTP_PORT=$smtp_port
INBUCKET_POP3_PORT=$pop3_port
INBUCKET_LOGLEVEL=$loglevel
INBUCKET_MAILBOXNAMING=local
INBUCKET_SMTP_DOMAIN=$smtp_domain
INBUCKET_SMTP_DEFAULTACCEPT=true
INBUCKET_SMTP_DEFAULTSTORE=true
INBUCKET_WEB_MONITORVISIBLE=true
INBUCKET_WEB_MONITORHISTORY=50
INBUCKET_STORAGE_TYPE=file
INBUCKET_STORAGE_PARAMS=path:/storage
INBUCKET_STORAGE_RETENTIONPERIOD=$retention_period
INBUCKET_STORAGE_MAILBOXMSGCAP=$mailbox_cap
EOF

  cat >"$compose_file" <<'EOF'
services:
  inbucket:
    image: ${INBUCKET_IMAGE}
    container_name: ${INBUCKET_CONTAINER_NAME}
    restart: unless-stopped
    ports:
      - "${INBUCKET_WEB_PORT}:9000"
      - "${INBUCKET_SMTP_PORT}:2500"
      - "${INBUCKET_POP3_PORT}:1100"
    environment:
      INBUCKET_LOGLEVEL: ${INBUCKET_LOGLEVEL}
      INBUCKET_MAILBOXNAMING: ${INBUCKET_MAILBOXNAMING}
      INBUCKET_SMTP_ADDR: 0.0.0.0:2500
      INBUCKET_SMTP_DOMAIN: ${INBUCKET_SMTP_DOMAIN}
      INBUCKET_SMTP_DEFAULTACCEPT: ${INBUCKET_SMTP_DEFAULTACCEPT}
      INBUCKET_SMTP_DEFAULTSTORE: ${INBUCKET_SMTP_DEFAULTSTORE}
      INBUCKET_POP3_ADDR: 0.0.0.0:1100
      INBUCKET_WEB_ADDR: 0.0.0.0:9000
      INBUCKET_WEB_MONITORVISIBLE: ${INBUCKET_WEB_MONITORVISIBLE}
      INBUCKET_WEB_MONITORHISTORY: ${INBUCKET_WEB_MONITORHISTORY}
      INBUCKET_STORAGE_TYPE: ${INBUCKET_STORAGE_TYPE}
      INBUCKET_STORAGE_PARAMS: ${INBUCKET_STORAGE_PARAMS}
      INBUCKET_STORAGE_RETENTIONPERIOD: ${INBUCKET_STORAGE_RETENTIONPERIOD}
      INBUCKET_STORAGE_MAILBOXMSGCAP: ${INBUCKET_STORAGE_MAILBOXMSGCAP}
    volumes:
      - ./INBUCKET-DATA/config:/config
      - ./INBUCKET-DATA/storage:/storage
EOF

  perl -0pi -e "s|INBUCKET-DATA|$data_basename|g" "$compose_file"

  printf 'generated %s and %s\n' "$compose_file" "$env_file"
  printf 'smtp-domain=%s\n' "$smtp_domain"
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required for mode: $mode" >&2
    exit 1
  fi
}

run_compose() {
  require_docker
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

case "$mode" in
  render)
    render_bundle
    ;;
  up)
    render_bundle
    run_compose up -d
    run_compose ps
    ;;
  down)
    run_compose down
    ;;
  logs)
    run_compose logs -f --tail=200
    ;;
  ps)
    run_compose ps
    ;;
esac
