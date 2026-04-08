#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
SETUP_LANG="zh-CN"
# shellcheck source=./lib/env.sh
. "$ROOT_DIR/scripts/lib/env.sh"

trim_whitespace() {
  local value="$1"

  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"

  printf '%s' "$value"
}

msg() {
  local key="$1"

  case "${SETUP_LANG}:${key}" in
    zh-CN:docker_required) printf '%s' "需要先安装 docker" ;;
    en:docker_required) printf '%s' "docker is required" ;;
    zh-CN:env_created) printf '%s' "已根据 .env.example 创建 %s" ;;
    en:env_created) printf '%s' "created %s from .env.example" ;;
    zh-CN:noninteractive_missing) printf '%s' "错误：%s 缺少必填值，而且当前 stdin 不是交互终端" ;;
    en:noninteractive_missing) printf '%s' "error: %s is missing required values and stdin is not interactive" ;;
    zh-CN:noninteractive_fill) printf '%s' "请先在 %s 中填写 TMPMAIL_ADMIN_PASSWORD 和 TMPMAIL_MAIL_EXCHANGE_HOST，或在终端里重新执行 ./scripts/dev-up.sh" ;;
    en:noninteractive_fill) printf '%s' "fill TMPMAIL_ADMIN_PASSWORD and TMPMAIL_MAIL_EXCHANGE_HOST in %s, or rerun ./scripts/dev-up.sh in a terminal" ;;
    zh-CN:language_prompt) printf '%s' "选择语言 [1=简体中文, 2=English，默认 1]: " ;;
    en:language_prompt) printf '%s' "Choose language [1=简体中文, 2=English, default 1]: " ;;
    zh-CN:admin_password_prompt) printf '%s' "请输入 TMPMAIL_ADMIN_PASSWORD（至少 10 位）: " ;;
    en:admin_password_prompt) printf '%s' "TMPMAIL_ADMIN_PASSWORD (at least 10 chars): " ;;
    zh-CN:admin_password_short) printf '%s' "密码长度不足 10 位，请重试" ;;
    en:admin_password_short) printf '%s' "password is too short" ;;
    zh-CN:admin_password_confirm) printf '%s' "请再次输入 TMPMAIL_ADMIN_PASSWORD: " ;;
    en:admin_password_confirm) printf '%s' "Confirm TMPMAIL_ADMIN_PASSWORD: " ;;
    zh-CN:admin_password_mismatch) printf '%s' "两次输入的密码不一致，请重试" ;;
    en:admin_password_mismatch) printf '%s' "passwords did not match" ;;
    zh-CN:mail_exchange_prompt) printf '%s' "请输入 TMPMAIL_MAIL_EXCHANGE_HOST（例如 mail.example.com）: " ;;
    en:mail_exchange_prompt) printf '%s' "TMPMAIL_MAIL_EXCHANGE_HOST (example: mail.example.com): " ;;
    zh-CN:mail_exchange_invalid) printf '%s' "这里只能填写主机名，例如 mail.example.com" ;;
    en:mail_exchange_invalid) printf '%s' "enter a hostname only, for example mail.example.com" ;;
    zh-CN:admin_password_existing_invalid) printf '%s' "%s 中的 TMPMAIL_ADMIN_PASSWORD 缺失，或长度不足 10 位" ;;
    en:admin_password_existing_invalid) printf '%s' "TMPMAIL_ADMIN_PASSWORD in %s is missing or shorter than 10 characters" ;;
    zh-CN:mail_exchange_existing_invalid) printf '%s' "%s 中的 TMPMAIL_MAIL_EXCHANGE_HOST 不合法" ;;
    en:mail_exchange_existing_invalid) printf '%s' "TMPMAIL_MAIL_EXCHANGE_HOST in %s is invalid" ;;
    zh-CN:saved_required_values) printf '%s' "已将必填部署参数写入 %s" ;;
    en:saved_required_values) printf '%s' "saved required deployment values to %s" ;;
    zh-CN:frontend_label) printf '%s' "前端" ;;
    en:frontend_label) printf '%s' "frontend" ;;
    zh-CN:admin_label) printf '%s' "管理台" ;;
    en:admin_label) printf '%s' "admin" ;;
    zh-CN:api_label) printf '%s' "API" ;;
    en:api_label) printf '%s' "api" ;;
    zh-CN:next_step_header) printf '%s' "下一步：DNS / Cloudflare 配置" ;;
    en:next_step_header) printf '%s' "Next step: DNS / Cloudflare" ;;
    zh-CN:dns_step_1) printf '%s' "1. 先为 %s 创建一条仅 DNS 的 A/AAAA 记录，指向当前服务器公网 IP。" ;;
    en:dns_step_1) printf '%s' "1. Create a DNS-only A/AAAA record for %s that points to this server's public IP." ;;
    zh-CN:dns_step_2) printf '%s' "2. 打开管理台，添加你要托管的每个域名。" ;;
    en:dns_step_2) printf '%s' "2. Open the admin console and add each managed domain." ;;
    zh-CN:dns_step_3) printf '%s' "3. 对每个托管域名，按管理台显示添加以下 DNS 记录：" ;;
    en:dns_step_3) printf '%s' "3. For each managed domain, add the DNS records shown in the admin UI:" ;;
    zh-CN:dns_step_3_cname) printf '%s' "   - CNAME mail.<domain> -> %s" ;;
    en:dns_step_3_cname) printf '%s' "   - CNAME mail.<domain> -> %s" ;;
    zh-CN:dns_step_3_mx) printf '%s' "   - MX    <domain> -> %s %s" ;;
    en:dns_step_3_mx) printf '%s' "   - MX    <domain> -> %s %s" ;;
    zh-CN:dns_step_3_txt) printf '%s' "   - TXT   %s -> <管理台里的 verification token>" ;;
    en:dns_step_3_txt) printf '%s' "   - TXT   %s -> <verification token from admin UI>" ;;
    zh-CN:dns_step_4) printf '%s' "4. 可选：在管理台保存带有 Zone:Read 和 DNS:Edit 权限的 Cloudflare API Token，开启自动同步 DNS。" ;;
    en:dns_step_4) printf '%s' "4. Optional: save a Cloudflare API token with Zone:Read and DNS:Edit to enable automatic DNS sync." ;;
    zh-CN:mail_exchange_empty) printf '%s' "TMPMAIL_MAIL_EXCHANGE_HOST 仍然为空。" ;;
    en:mail_exchange_empty) printf '%s' "TMPMAIL_MAIL_EXCHANGE_HOST is empty." ;;
    zh-CN:mail_exchange_empty_hint) printf '%s' "请先在 %s 中填写一个稳定的公网 MX 主机名，例如 mail.example.com，然后重新执行本命令。" ;;
    en:mail_exchange_empty_hint) printf '%s' "Set it in %s to a stable public MX hostname such as mail.example.com, then rerun this command." ;;
    *)
      printf '%s' "$key"
      ;;
  esac
}

say() {
  printf '%s\n' "$(msg "$1")"
}

sayf() {
  local key="$1"
  shift
  printf "$(msg "$key")\n" "$@"
}

say_err() {
  printf '%s\n' "$(msg "$1")" >&2
}

sayf_err() {
  local key="$1"
  shift
  printf "$(msg "$key")\n" "$@" >&2
}

choose_language() {
  local choice

  if [ ! -t 0 ]; then
    SETUP_LANG="zh-CN"
    return 0
  fi

  printf '%s' "$(msg language_prompt)"
  read -r choice || true
  choice="$(trim_whitespace "$choice")"

  case "$choice" in
    2|en|EN|english|English)
      SETUP_LANG="en"
      ;;
    *)
      SETUP_LANG="zh-CN"
      ;;
  esac
}

choose_language

if ! command -v docker >/dev/null 2>&1; then
  say docker_required
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  sayf env_created "$ENV_FILE"
fi

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
    sayf noninteractive_missing "$ENV_FILE"
    sayf noninteractive_fill "$ENV_FILE"
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
    *://*|*/*|*:*|*[[:space:]]*)
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
    printf '%s' "$(msg admin_password_prompt)" >&2
    read -r -s password
    printf '\n' >&2

    if ! valid_admin_password "$password"; then
      say_err admin_password_short
      continue
    fi

    printf '%s' "$(msg admin_password_confirm)" >&2
    read -r -s confirm
    printf '\n' >&2

    if [ "$password" != "$confirm" ]; then
      say_err admin_password_mismatch
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
    printf '%s' "$(msg mail_exchange_prompt)" >&2
    read -r value
    value="$(trim_whitespace "$value")"

    if ! valid_mail_exchange_host "$value"; then
      say_err mail_exchange_invalid
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
    sayf admin_password_existing_invalid "$ENV_FILE"
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
    sayf mail_exchange_existing_invalid "$ENV_FILE"
  fi
  mail_exchange_host="$(prompt_mail_exchange_host)"
fi
env_upsert "TMPMAIL_MAIL_EXCHANGE_HOST" "$mail_exchange_host"

sayf saved_required_values "$ENV_FILE"

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

workspace_locale_path="/zh"
if [ "$SETUP_LANG" = "en" ]; then
  workspace_locale_path="/en"
fi

printf '%-8s %s\n' "$(msg frontend_label):" "http://${public_host}:${frontend_port:-3000}${workspace_locale_path}"
printf '%-8s %s\n' "$(msg admin_label):" "http://${public_host}:${frontend_port:-3000}${admin_entry_path}"
printf '%-8s %s\n' "$(msg api_label):" "http://127.0.0.1:${api_port:-8080}/healthz"

printf '\n== %s ==\n' "$(msg next_step_header)"
if [ -n "$mail_exchange_host" ]; then
  sayf dns_step_1 "$mail_exchange_host"
  say dns_step_2
  say dns_step_3
  sayf dns_step_3_cname "$mail_exchange_host"
  sayf dns_step_3_mx "$mail_exchange_priority" "$mail_exchange_host"
  sayf dns_step_3_txt "$txt_record_name"
  say dns_step_4
else
  say mail_exchange_empty
  sayf mail_exchange_empty_hint "$ENV_FILE"
fi
