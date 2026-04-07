# TmpMail Security Review

## Executive Summary

本轮按“直接 `docker compose up -d --build` 上公网服务器”的前提做了实测和审计。

当前结论：

- 没有保留未修复的 Critical / High 级应用层漏洞。
- 审计中发现了一个 High 级漏洞：默认直连部署时，客户端可伪造 `X-Forwarded-*` 头绕过管理台 HTTPS 要求并污染限流来源判断。该问题已在本次审计中修复。
- 仍有 1 个 Medium 级安全硬化问题未处理：前端 CSP 仍允许 `script-src 'unsafe-inline'`。
- 仍有 1 个部署阻塞项需要在目标服务器验证：当前主机上宿主机 `25/TCP` 没有真正监听成功，因此“公网 MX 可收件”尚未在当前环境被证明。

## Resolved During Audit

### RES-001

- Severity: High
- Status: Fixed in workspace
- Location:
  [src/config.rs](/data/WorkSpace/tmpmail/src/config.rs#L14)
  [src/auth.rs](/data/WorkSpace/tmpmail/src/auth.rs#L180)
  [src/auth.rs](/data/WorkSpace/tmpmail/src/auth.rs#L293)
  [src/routes/admin.rs](/data/WorkSpace/tmpmail/src/routes/admin.rs#L1034)
  [frontend/app/api/mail/route.ts](/data/WorkSpace/tmpmail/frontend/app/api/mail/route.ts#L26)
  [frontend/app/api/sse/route.ts](/data/WorkSpace/tmpmail/frontend/app/api/sse/route.ts#L11)
  [frontend/lib/admin-session-server.ts](/data/WorkSpace/tmpmail/frontend/lib/admin-session-server.ts#L5)
  [compose.yaml](/data/WorkSpace/tmpmail/compose.yaml#L67)
  [.env.example](/data/WorkSpace/tmpmail/.env.example#L69)
- Evidence:
  直接对 `http://127.0.0.1:3001/api/mail?endpoint=/admin/login` 发送带 `X-Forwarded-Proto: https` 的请求，修复前返回 `200`；修复后同样请求返回 `403`。
- Impact:
  在默认直连 HTTP 部署中，攻击者可以伪造“我是 HTTPS / 可信代理”的请求头，绕过管理台 HTTPS 保护，并污染基于来源 IP 的认证/OTP 限流键。
- Fix:
  新增 `TMPMAIL_TRUST_PROXY_HEADERS`，默认 `false`。
  后端只有在显式开启该开关时才信任 `X-Forwarded-*` / `Forwarded`。
  前端 BFF 和 SSE 代理也只有在显式开启该开关时才会转发代理头，并据此决定 Secure cookie。
- Mitigation:
  对于默认 `docker compose` 直连部署，保持 `TMPMAIL_TRUST_PROXY_HEADERS=false`。
  只有当前面确实有一层会覆盖这些头的可信反向代理时，才设置为 `true`。

## Open Findings

### SEC-001

- Severity: Medium
- Location:
  [frontend/next.config.mjs](/data/WorkSpace/tmpmail/frontend/next.config.mjs#L6)
- Evidence:
  生产 CSP 仍包含 `script-src 'self' 'unsafe-inline'`。本轮已把生产 `connect-src` 收紧为同源，但还没有完成 nonce/hash 驱动的脚本策略。
- Impact:
  这不会直接制造 XSS，但会显著削弱浏览器侧对脚本执行的兜底能力。一旦未来引入可利用的 DOM XSS 或第三方脚本污染点，当前 CSP 仍不足以强约束内联脚本执行。
- Fix:
  后续应改为 nonce/hash 驱动的脚本策略。
- Mitigation:
  在未收紧 CSP 前，避免引入新的 HTML 注入点、第三方脚本和跨站连接面；继续保持 `sessionToken` 仅走 HttpOnly cookie，不回到浏览器 JS。
- False positive notes:
  这是一项“防线偏弱”问题，不代表当前仓库里已经存在可利用的前端 XSS。

## Deployment Gaps

### DEP-001

- Severity: Operational blocker
- Location:
  [compose.yaml](/data/WorkSpace/tmpmail/compose.yaml#L138)
- Evidence:
  当前主机上 `nc 127.0.0.1 25` 返回 `Connection refused`，而容器内 `inbucket` 自身 `2500/TCP` 正常可连。
- Impact:
  这意味着“公网发件服务器通过 MX 直连宿主机 `25/TCP` 投递邮件”在当前机器上并未成立；即使应用内部收件链路可用，也不能据此认定公网 SMTP 已经打通。
- Fix:
  在目标服务器上确认 Docker 具备绑定低位端口的能力，并检查云防火墙 / 安全组 / 本机防火墙是否放行 `25/TCP`。
- Mitigation:
  上线前必须在目标服务器执行实际探测，例如 `ss -ltn sport = :25`、`docker port tmpmail-inbucket`、以及从外部主机对 `25/TCP` 做连通性测试。

## Verification Notes

- 通过了：
  `docker compose up -d --build`
  `docker compose ps`
  `curl http://127.0.0.1:18081/readyz`
  `curl http://127.0.0.1:3001/en`
  账户创建 / token / 邮件导入 / 原文下载 / 附件下载 / SSE 新邮件事件
  `cd frontend && npm run lint`
  `cd frontend && npm run build`
  `cd frontend && npm audit --omit=dev`
- 未完全通过：
  `cargo test`
  当前失败主要集中在测试数据库连接准备，现有环境没有给测试提供可创建临时库的可用 PostgreSQL 管理连接。
