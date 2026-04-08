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
    zh-CN:proxy_mode_prompt) printf '%s' "TmpMail 的公网入口方式 [1=直接暴露服务，无反代; 2=前面有可信 HTTPS 反向代理，且会覆盖 X-Forwarded-* / Forwarded 头]: " ;;
    en:proxy_mode_prompt) printf '%s' "TmpMail public entry mode [1=direct exposure without proxy; 2=trusted HTTPS reverse proxy overwrites X-Forwarded-* / Forwarded]: " ;;
    zh-CN:proxy_mode_invalid) printf '%s' "请输入 1 或 2" ;;
    en:proxy_mode_invalid) printf '%s' "enter 1 or 2" ;;
    zh-CN:trust_proxy_existing_invalid) printf '%s' "%s 中的 TMPMAIL_TRUST_PROXY_HEADERS 不合法，将重新询问部署方式" ;;
    en:trust_proxy_existing_invalid) printf '%s' "TMPMAIL_TRUST_PROXY_HEADERS in %s is invalid; deployment mode will be asked again" ;;
    zh-CN:saved_required_values) printf '%s' "已将必填部署参数写入 %s" ;;
    en:saved_required_values) printf '%s' "saved required deployment values to %s" ;;
    zh-CN:trust_proxy_saved_true) printf '%s' "已启用 TMPMAIL_TRUST_PROXY_HEADERS=true，用于可信 HTTPS 反向代理场景" ;;
    en:trust_proxy_saved_true) printf '%s' "set TMPMAIL_TRUST_PROXY_HEADERS=true for a trusted HTTPS reverse proxy deployment" ;;
    zh-CN:trust_proxy_saved_false) printf '%s' "已保持 TMPMAIL_TRUST_PROXY_HEADERS=false，适用于直接暴露服务或不可信代理头场景" ;;
    en:trust_proxy_saved_false) printf '%s' "kept TMPMAIL_TRUST_PROXY_HEADERS=false for direct exposure or untrusted proxy headers" ;;
    zh-CN:smtp_check_ok) printf '%s' "SMTP 入口检查通过：宿主机 %s -> inbucket:2500，且本机 127.0.0.1:25 可连" ;;
    en:smtp_check_ok) printf '%s' "SMTP ingress check passed: host %s -> inbucket:2500, and local 127.0.0.1:25 is reachable" ;;
    zh-CN:smtp_check_header) printf '%s' "错误：SMTP 入口未真正暴露" ;;
    en:smtp_check_header) printf '%s' "Error: SMTP ingress is not actually published" ;;
    zh-CN:smtp_check_failed) printf '%s' "TmpMail 当前不会成功接收公网来信，因为宿主机 25/TCP 没有真正映射到 inbucket 的 2500/TCP。" ;;
    en:smtp_check_failed) printf '%s' "TmpMail will not receive public email right now because host 25/TCP is not actually mapped to inbucket 2500/TCP." ;;
    zh-CN:smtp_check_detected_binding) printf '%s' "脚本检测到的当前端口发布结果：%s" ;;
    en:smtp_check_detected_binding) printf '%s' "Detected current published port result: %s" ;;
    zh-CN:smtp_check_local_probe_result) printf '%s' "本机 127.0.0.1:25 探测结果：%s" ;;
    en:smtp_check_local_probe_result) printf '%s' "Local 127.0.0.1:25 probe result: %s" ;;
    zh-CN:smtp_check_expected_binding) printf '%s' "期望结果应是宿主机 25/TCP 对应到 inbucket:2500，而不是空值或其他端口。" ;;
    en:smtp_check_expected_binding) printf '%s' "Expected result: host 25/TCP must map to inbucket:2500, not an empty value or another port." ;;
    zh-CN:smtp_check_cause_unprivileged) printf '%s' "常见原因 1：当前 Docker / 宿主环境不允许发布低位端口（<1024），例如 25/TCP。" ;;
    en:smtp_check_cause_unprivileged) printf '%s' "Common cause 1: the current Docker/host environment does not allow publishing privileged ports below 1024, such as 25/TCP." ;;
    zh-CN:smtp_check_cause_conflict) printf '%s' "常见原因 2：宿主机上已经有其他服务占用了 25/TCP，或 Docker 运行时没有真正接管该端口。" ;;
    en:smtp_check_cause_conflict) printf '%s' "Common cause 2: another host service already owns 25/TCP, or Docker did not actually take over that port." ;;
    zh-CN:smtp_check_cause_firewall) printf '%s' "常见原因 3：云安全组、宿主防火墙或机房策略阻断了 25/TCP，即使容器内 SMTP 正常也收不到公网来信。" ;;
    en:smtp_check_cause_firewall) printf '%s' "Common cause 3: your cloud firewall, host firewall, or provider policy blocks 25/TCP, so public email still cannot arrive even if SMTP works inside the container." ;;
    zh-CN:smtp_check_next) printf '%s' "请先在服务器上排查下面这几条，再继续 DNS / 域名验证：" ;;
    en:smtp_check_next) printf '%s' "Check the following on the server before continuing with DNS/domain verification:" ;;
    zh-CN:smtp_check_recreate_hint) printf '%s' "如果刚改过 Docker 或防火墙配置，先执行：docker compose up -d --force-recreate inbucket" ;;
    en:smtp_check_recreate_hint) printf '%s' "If you just changed Docker or firewall settings, run: docker compose up -d --force-recreate inbucket" ;;
    zh-CN:smtp_check_retry_recreate) printf '%s' "检测到 SMTP 入口异常，正在自动对 inbucket 执行一次强制重建后复检" ;;
    en:smtp_check_retry_recreate) printf '%s' "SMTP ingress check failed; automatically force-recreating inbucket once before rechecking" ;;
    zh-CN:mx_check_ok) printf '%s' "收件主机 SMTP 探测通过：%s" ;;
    en:mx_check_ok) printf '%s' "Mail-host SMTP probe passed: %s" ;;
    zh-CN:mx_check_header) printf '%s' "错误：收件主机当前无法建立 SMTP 连接" ;;
    en:mx_check_header) printf '%s' "Error: the configured mail host is not accepting SMTP connections" ;;
    zh-CN:mx_check_failed) printf '%s' "TmpMail 当前不会成功接收公网来信，因为 %s:25 现在无法建立 SMTP 连接。" ;;
    en:mx_check_failed) printf '%s' "TmpMail will not receive public email right now because %s:25 is not accepting SMTP connections." ;;
    zh-CN:mx_check_detected_error) printf '%s' "脚本探测结果：%s" ;;
    en:mx_check_detected_error) printf '%s' "Probe result: %s" ;;
    zh-CN:mx_check_dns_hint) printf '%s' "常见原因 1：%s 的 DNS 还没指到正确主机，或者被 Cloudflare 代理了；MX 主机必须是仅 DNS。" ;;
    en:mx_check_dns_hint) printf '%s' "Common cause 1: %s does not resolve to the correct host yet, or it is proxied by Cloudflare; MX hosts must be DNS-only." ;;
    zh-CN:mx_check_listener_hint) printf '%s' "常见原因 2：宿主机 25/TCP 没有真正监听，或 Docker 端口发布没有生效。" ;;
    en:mx_check_listener_hint) printf '%s' "Common cause 2: host 25/TCP is not actually listening, or Docker port publishing did not take effect." ;;
    zh-CN:mx_check_provider_hint) printf '%s' "常见原因 3：云安全组、宿主防火墙或机房策略直接拒绝了 25/TCP。" ;;
    en:mx_check_provider_hint) printf '%s' "Common cause 3: your cloud firewall, host firewall, or provider policy rejects 25/TCP." ;;
    zh-CN:mx_check_next) printf '%s' "请先确认下面几项，再继续让外部发件方重试：" ;;
    en:mx_check_next) printf '%s' "Check the following before asking external senders to retry:" ;;
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
    zh-CN:proxy_warning_header) printf '%s' "注意：管理台 HTTPS 判断" ;;
    en:proxy_warning_header) printf '%s' "Note: admin HTTPS detection" ;;
    zh-CN:proxy_warning_body) printf '%s' "如果你是通过 HTTPS 反向代理访问本站，而管理台登录仍然返回 403，请把 %s 设为 true，然后执行 docker compose up -d --force-recreate api frontend。" ;;
    en:proxy_warning_body) printf '%s' "If you access this site through an HTTPS reverse proxy and admin login still returns 403, set %s to true, then run docker compose up -d --force-recreate api frontend." ;;
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

parse_bool_setting() {
  local value

  value="$(trim_whitespace "$1")"
  case "${value,,}" in
    1|true|yes|on)
      printf '%s' "true"
      ;;
    0|false|no|off)
      printf '%s' "false"
      ;;
    *)
      printf '%s' ""
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

prompt_trust_proxy_headers() {
  local choice

  ensure_interactive_prompt

  while true; do
    printf '%s' "$(msg proxy_mode_prompt)" >&2
    read -r choice
    choice="$(trim_whitespace "$choice")"

    case "$choice" in
      1)
        printf '%s' "false"
        return 0
        ;;
      2)
        printf '%s' "true"
        return 0
        ;;
      *)
        say_err proxy_mode_invalid
        ;;
    esac
  done
}

verify_smtp_ingress() {
  local smtp_port_binding
  local published_port
  local local_probe_result

  smtp_port_binding="$(docker compose -f "$ROOT_DIR/compose.yaml" port inbucket 2500 2>/dev/null || true)"
  smtp_port_binding="$(trim_whitespace "$smtp_port_binding")"
  published_port="${smtp_port_binding##*:}"
  local_probe_result="$(
    python - <<'PY'
import socket

try:
    sock = socket.create_connection(("127.0.0.1", 25), timeout=6)
    try:
        sock.settimeout(3)
        banner = sock.recv(1024)
    except socket.timeout:
        banner = b""
    finally:
        sock.close()
    banner_text = banner.decode(errors="replace").strip() or "connected (no banner yet)"
    print(f"ok:{banner_text}")
except Exception as exc:
    print(f"connect_failed:{exc}")
PY
  )"
  local_probe_result="$(trim_whitespace "$local_probe_result")"

  if [ -n "$smtp_port_binding" ] && [ "$published_port" = "25" ] && [ "${local_probe_result#ok:}" != "$local_probe_result" ]; then
    sayf smtp_check_ok "$smtp_port_binding"
    return 0
  fi

  printf '\n== %s ==\n' "$(msg smtp_check_header)" >&2
  say_err smtp_check_failed
  if [ -n "$smtp_port_binding" ]; then
    sayf_err smtp_check_detected_binding "$smtp_port_binding"
  fi
  if [ -n "$local_probe_result" ]; then
    sayf_err smtp_check_local_probe_result "${local_probe_result#*:}"
  fi
  say_err smtp_check_expected_binding
  say_err smtp_check_cause_unprivileged
  say_err smtp_check_cause_conflict
  say_err smtp_check_cause_firewall
  say_err smtp_check_next
  printf '  docker compose port inbucket 2500\n' >&2
  printf "  docker inspect --format '{{json .NetworkSettings.Ports}}' tmpmail-inbucket\n" >&2
  printf '  ss -ltn | grep ":25"\n' >&2
  say_err smtp_check_recreate_hint

  return 1
}

probe_mail_exchange_smtp() {
  local host="$1"

  python - "$host" <<'PY'
import socket
import sys

host = sys.argv[1].strip()

try:
    infos = socket.getaddrinfo(host, 25, proto=socket.IPPROTO_TCP)
except Exception as exc:
    print(f"resolve_failed:{exc}")
    sys.exit(2)

seen = set()
last_error = "no resolved addresses"

for family, socktype, proto, _, sockaddr in infos:
    ip = sockaddr[0]
    if ip in seen:
        continue
    seen.add(ip)

    sock = None
    try:
        sock = socket.socket(family, socktype, proto)
        sock.settimeout(6)
        sock.connect(sockaddr)
        try:
            banner = sock.recv(1024)
        except socket.timeout:
            banner = b""
        banner_text = banner.decode(errors="replace").strip() or "connected (no banner yet)"
        print(f"ok:{ip}:{banner_text}")
        sys.exit(0)
    except Exception as exc:
        last_error = f"{ip}: {exc}"
    finally:
        if sock is not None:
            sock.close()

print(f"connect_failed:{last_error}")
sys.exit(1)
PY
}

verify_mail_exchange_connectivity() {
  local host="$1"
  local probe_result

  probe_result="$(probe_mail_exchange_smtp "$host" || true)"
  probe_result="$(trim_whitespace "$probe_result")"

  case "$probe_result" in
    ok:*)
      sayf mx_check_ok "${probe_result#ok:}"
      return 0
      ;;
    resolve_failed:*|connect_failed:*)
      printf '\n== %s ==\n' "$(msg mx_check_header)" >&2
      sayf_err mx_check_failed "$host"
      sayf_err mx_check_detected_error "${probe_result#*:}"
      sayf_err mx_check_dns_hint "$host"
      say_err mx_check_listener_hint
      say_err mx_check_provider_hint
      say_err mx_check_next
      printf '  host %s\n' "$host" >&2
      printf '  python - <<'\''PY'\''\n' >&2
      printf 'import socket\n' >&2
      printf 'print(socket.create_connection(("%s", 25), timeout=6).recv(1024))\n' "$host" >&2
      printf 'PY\n' >&2
      printf '  docker compose port inbucket 2500\n' >&2
      printf '  ss -ltn | grep ":25"\n' >&2
      printf '  docker compose logs inbucket --tail=100\n' >&2
      return 1
      ;;
    *)
      printf '\n== %s ==\n' "$(msg mx_check_header)" >&2
      sayf_err mx_check_failed "$host"
      sayf_err mx_check_detected_error "$probe_result"
      return 1
      ;;
  esac
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

trust_proxy_headers="${TMPMAIL_TRUST_PROXY_HEADERS:-}"
if [ -z "$trust_proxy_headers" ]; then
  trust_proxy_headers="$(env_read TMPMAIL_TRUST_PROXY_HEADERS "$ENV_FILE" 2>/dev/null || true)"
fi
trust_proxy_headers="$(parse_bool_setting "$trust_proxy_headers")"
if [ -z "$trust_proxy_headers" ]; then
  current_proxy_value="$(env_read TMPMAIL_TRUST_PROXY_HEADERS "$ENV_FILE" 2>/dev/null || true)"
  if [ -n "${current_proxy_value:-}" ]; then
    sayf trust_proxy_existing_invalid "$ENV_FILE"
  fi
  trust_proxy_headers="$(prompt_trust_proxy_headers)"
fi
env_upsert "TMPMAIL_TRUST_PROXY_HEADERS" "$trust_proxy_headers"

sayf saved_required_values "$ENV_FILE"
if [ "$trust_proxy_headers" = "true" ]; then
  say trust_proxy_saved_true
else
  say trust_proxy_saved_false
fi

docker compose -f "$ROOT_DIR/compose.yaml" up --build -d
docker compose -f "$ROOT_DIR/compose.yaml" ps
if ! verify_smtp_ingress; then
  say smtp_check_retry_recreate
  docker compose -f "$ROOT_DIR/compose.yaml" up -d --force-recreate inbucket
  verify_smtp_ingress
fi
verify_mail_exchange_connectivity "$mail_exchange_host"

frontend_port="${TMPMAIL_FRONTEND_PORT:-}"
api_port="${TMPMAIL_PORT:-}"
public_host="${TMPMAIL_PUBLIC_HOST:-}"
admin_require_secure_transport="${TMPMAIL_ADMIN_REQUIRE_SECURE_TRANSPORT:-}"
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

if [ -z "$admin_require_secure_transport" ]; then
  admin_require_secure_transport="$(env_read TMPMAIL_ADMIN_REQUIRE_SECURE_TRANSPORT "$ENV_FILE" 2>/dev/null || true)"
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

admin_require_secure_transport="$(parse_bool_setting "$admin_require_secure_transport")"
if [ -z "$admin_require_secure_transport" ]; then
  admin_require_secure_transport="true"
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

if [ "$admin_require_secure_transport" != "false" ] && [ "$trust_proxy_headers" = "false" ]; then
  printf '\n== %s ==\n' "$(msg proxy_warning_header)"
  sayf proxy_warning_body "TMPMAIL_TRUST_PROXY_HEADERS"
fi
