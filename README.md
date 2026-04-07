# TmpMail Minimal Stack

当前目录提供的是第一版最小可部署实现：

- 一个可运行的 Rust API 服务
- 一个可直接联调的 Next.js 前端
- 一套开箱即用的 Docker 镜像与 `compose.yaml`
- 内置同机部署的 Inbucket 收件层
- 所有运行时持久化数据都固定落在当前目录 `./data/`
- 已接入管理员域名后台、全局域名管理、DNS 配置展示和手动/自动验证

## Quick Start

1. 复制环境变量模板：

   `cp .env.example .env`

2. 编辑 `.env`，至少确认以下字段：

   - `TMPMAIL_ADMIN_PASSWORD`，默认会以固定用户名 `admin` 引导后台管理员；至少 10 位
   - `TMPMAIL_MAIL_EXCHANGE_HOST`，必须指向真正对外提供 MX 的稳定公网主机名，例如 `mail.your-domain.tld`
   - 默认 compose 部署不需要手写 `TMPMAIL_DATABASE_URL`
   - `TMPMAIL_JWT_SECRET` 和 `TMPMAIL_POSTGRES_PASSWORD` 留空即可；`secrets-init` 会在首次启动时自动生成，并持久化到 `./data/runtime-secrets/`
   - 如需查看自动生成值，可执行 `docker compose logs secrets-init`
   - 因为你要求“日志里可见”，生成值会出现在 `secrets-init` 容器日志里；这很方便，但也意味着 Docker 日志访问权限本身就是敏感权限
   - 只有在你不使用 compose 自带 PostgreSQL、或者要让宿主机直跑的后端连接外部数据库时，才需要显式设置 `TMPMAIL_DATABASE_URL`
   - 默认建议保留 `TMPMAIL_ADMIN_PASSWORD_MODE=bootstrap`；只有救援或显式重置密码时才考虑 `force`
   - 本地 HTTP 联调可设 `TMPMAIL_ADMIN_REQUIRE_SECURE_TRANSPORT=false`
   - `TMPMAIL_TRUST_PROXY_HEADERS` 默认应保持 `false`；只有在前面明确有一层可信反向代理负责覆盖 `X-Forwarded-*` / `Forwarded` 头时才改成 `true`
   - 配置后，托管域名会统一生成 `CNAME mail.<domain> -> <共享收件主机>`、`MX <domain> -> <共享收件主机>`、`TXT <domain> -> <verification token>`
   - 如果你不配 `TMPMAIL_MAIL_EXCHANGE_HOST`，系统会回退为每个域名自己的 `mail.<domain>` 路由，这时通常还要额外配置 `TMPMAIL_MAIL_CNAME_TARGET`
   - 如果 API 镜像构建阶段卡在 `Updating crates.io index`，可设置 `TMPMAIL_CARGO_MIRROR=sparse+https://rsproxy.cn/index/`
   - 如果前端镜像构建阶段卡在 `npm ci`，可设置 `TMPMAIL_NPM_REGISTRY=https://registry.npmmirror.com`
   - 前端构建阶段也支持 `TMPMAIL_NPM_FETCH_TIMEOUT`
   - 构建阶段也支持 `TMPMAIL_CARGO_REGISTRY_PROTOCOL`、`TMPMAIL_CARGO_NET_RETRY`、`TMPMAIL_CARGO_HTTP_TIMEOUT`
   - 如果希望前端首页、示例邮箱和品牌展示优先使用一个固定域名，可设置 `NEXT_PUBLIC_TMPMAIL_DEFAULT_DOMAIN`

3. 启动服务：

   `docker compose up -d --build`

4. 打开前端：

   `http://<your-server-ip-or-domain>:${TMPMAIL_FRONTEND_PORT}/en`

   管理台入口：

   `http://<your-server-ip-or-domain>:${TMPMAIL_FRONTEND_PORT}/admin`

5. 跑最小 smoke：

   `./scripts/smoke.sh`

## PostgreSQL

- 现在后端是 PostgreSQL-only；默认 compose 部署会自动根据 `TMPMAIL_POSTGRES_*` 和 `./data/runtime-secrets/postgres_password` 生成连接串。
- 服务启动时会自动执行 `migrations/` 下的建表迁移。
- `/readyz` 会实际执行数据库探测，Compose 也用它做 API 健康检查。
- 仓库自带的 `compose.yaml` 默认会把 API、前端、PostgreSQL、Inbucket 一起拉起。
- 运行时持久化数据只会写到当前目录下的 `./data/postgres`、`./data/inbucket/config`、`./data/inbucket/storage`、`./data/runtime-secrets`。
- 默认端口现在只绑定到 `127.0.0.1`；如果你不手填 `TMPMAIL_POSTGRES_PASSWORD`，compose 会在首次启动自动生成并持久化。
- 默认 compose 部署时，API 容器会固定通过 Docker 服务名 `postgres:5432` 访问数据库，并自动生成等价于下面的连接串：

  `postgres://tmpmail:<自动 URL 编码后的 TMPMAIL_POSTGRES_PASSWORD>@postgres:5432/tmpmail`

- 只有在你把后端直接跑在宿主机上、或者改接外部 PostgreSQL 时，才需要自己设置 `TMPMAIL_DATABASE_URL`。
- 这时如果数据库在宿主机本机，通常可写成 `postgres://tmpmail:<URL 编码后的密码>@127.0.0.1:${TMPMAIL_POSTGRES_PORT:-5432}/tmpmail`。
- 如果 `./data/postgres` 已经存在，但 `./data/runtime-secrets/postgres_password` 丢了，默认 compose 不会擅自重生一个新密码，而是直接报错，防止把现有数据库密码状态搞乱。

## Admin Domains

- 后台现在是独立的 console 用户体系，默认入口仍是 `/admin`：

  1. 默认部署会在首次启动时按 `TMPMAIL_ADMIN_PASSWORD` 自动引导固定管理员用户 `admin`
  2. 之后所有后台成员都通过“用户名 + 密码”登录
  3. 角色分为 `admin` 和 `user`
  4. `admin` 可以管理后台用户、每个用户可添加的域名数量、系统启停状态、共享收件主机配置、日志与清理任务
  5. `user` 可以获取自己的后台 API Key、添加域名、查看 DNS 记录、执行域名验证

- 管理后台默认入口是 `/admin`，也可通过 `TMPMAIL_ADMIN_ENTRY_PATH` 改成自定义入口。
- 管理台是独立页面，不在主导航里直接暴露。
- 控制台 session 现在只保存在前端 BFF 管理的 HttpOnly cookie 中；浏览器 JavaScript 不再读取或持久化 console JWT，`/api/mail` 会在服务端为控制台请求补 `Authorization`。
- `TMPMAIL_ADMIN_PASSWORD` 现在是默认部署必填，并且要配合 `TMPMAIL_ADMIN_PASSWORD_MODE` 使用：
  - `bootstrap`：仅在首次引导时创建默认 `admin`
  - `force`：显式强制覆盖现有 `admin` 密码，只建议短时开发/救援使用
  - `disabled`：完全忽略该环境变量
- 默认部署建议保持 `bootstrap`，这样首次启动就会稳定创建 `admin` 用户，不再依赖首次进页面手工引导。
- 控制台密码和邮箱密码现在都要求至少 10 位；Argon2 参数也已固定为显式的 Argon2id 配置，避免运行时默认值漂移。
- 控制台用户、密码哈希、后台 API Key 哈希和系统设置都持久化在 PostgreSQL。
- 邮箱 OTP 状态也持久化在 PostgreSQL；验证码落库前会先哈希，不保存明文。
- Cloudflare API token 会单独持久化到数据库，不会混入其他业务状态记录。
- 如果忘记管理员密码，可临时设置 `TMPMAIL_ADMIN_RECOVERY_TOKEN`，然后在 `/admin` 页面按用户名使用恢复令牌重置密码。恢复成功后会同时轮换新的后台 Key。恢复令牌不会落盘，建议只在可信环境短暂启用，用完立刻删除。
- `GET /admin/access-key` 不再隐式创建新 Key；只有显式创建或轮换接口才会签发新的明文密钥。
- Linux Do OAuth 现在支持配置精确的 `callback_url` 白名单；如未配置，回调地址也必须与当前管理台来源同源，且只接受更严格的 `state` 格式。
- `TMPMAIL_ADMIN_REQUIRE_SECURE_TRANSPORT` 默认是 `true`；只有本地开发或可信内网测试时才建议关掉。
- `TMPMAIL_TRUST_PROXY_HEADERS` 默认是 `false`；直接用 `docker compose` 暴露服务时不要打开。只有在你确认前面的反向代理会清洗并重写 `X-Forwarded-*` / `Forwarded` 头时，才应该设成 `true`。
- 如确实要在本地保留弱测试 JWT secret，必须显式设置 `TMPMAIL_ALLOW_INSECURE_DEV_SECRETS=true`；默认不会再接受占位 secret。
- 当前端检测到 `TMPMAIL_ADMIN_REQUIRE_SECURE_TRANSPORT=false` 时，`/admin` 页面会允许在本地 HTTP/内网调试环境里直接初始化后台用户、登录和轮换后台 Key。
- 后台 API Key 现在按 console 用户分别生成，服务端只保存哈希；明文只会在签发或轮换当次显示。
- `/domains` 旧入口仍然保留，但会重定向到当前配置的管理员入口。
- 后端会按 `TMPMAIL_DOMAIN_VERIFICATION_POLL_INTERVAL_SECONDS` 自动轮询未验证域名。
- 托管域名只有在状态变为 `active` 后才允许所有用户创建邮箱账户。
- 默认 DNS 方案会生成：
  - `CNAME mail.<domain> -> <共享收件主机>`，例如 `mail.fuckmail.online`
  - `MX <domain> -> <共享收件主机>`
  - `TXT <domain> -> <verification token>`

如果本机 `8080` 端口已被占用，可以把 API 改到 `18080` 再联调前端，例如：

`TMPMAIL_PORT=18080 cargo run`

前端代理层对应的服务地址可通过 `TMPMAIL_SERVER_API_BASE_URL=http://127.0.0.1:18080` 覆盖。

## Inbucket

主 `compose.yaml` 现在会直接拉起 Inbucket，TmpMail API 走容器内网访问 `http://inbucket:9000`，不再需要额外的 Inbucket 部署脚本或单独的 compose 文件。

这一版 Inbucket 作为统一收件层默认接受所有域名，不把域名列表写死到容器配置里。后续 TmpMail 面板里的加减域名由我们自己的后端做验证、入库和放行控制，而不是靠重启 Inbucket。

注意：

- 如果这个 Inbucket 要作为公网 MX 收件主机，宿主机必须对外开放 `25/TCP`；主 compose 已经把宿主机 `25` 映射到容器内 `2500`。
- 当前主 compose 不会把 Inbucket 的 Web UI `9000` 和 POP3 `1100` 暴露到宿主机；TmpMail 自己通过 Docker 内网访问 Inbucket。
- 当前 compose 还把 `frontend` 与 `inbucket` / `postgres` 拆到了不同网络；前端容器不能直接访问这两个后端服务。
- Inbucket 监控页默认关闭，镜像已固定到不可变 digest，容器能力也被压到 `cap_drop: ALL` + `no-new-privileges`。
- 这意味着默认部署更简单，也避免了把 Inbucket Web/API 额外公开到公网。
- 对真实公网域名，建议显式配置 `TMPMAIL_MAIL_EXCHANGE_HOST=mail.your-domain.tld`，让后台 DNS 记录始终指向稳定的公网收件主机名，而不是依赖内部容器地址推导。
- 外部邮件服务器只会对 MX 主机发起 `25/TCP` 连接，不会改连 `2500`。
- `2500` 只适合本地联调或内网测试；拿它直接做公网 MX 时，发件方通常会报“对方服务器未响应”或持续重试。

## Notes

- 当前后端只使用 PostgreSQL 持久化；不再保留 JSON 状态文件、文件 fallback 或首次导库逻辑。
- 默认部署使用内置同机 Inbucket；如后续确实要拆分邮件接入层，远端 Inbucket 配置能力仍然保留。
- Compose 现在内置同机 Inbucket：API 通过 Docker 内网访问 `inbucket:9000`，宿主机默认只对外暴露 SMTP `25/TCP`。
- `compose.yaml` 现在把 `frontend` 与 `postgres` / `inbucket` 分到不同网络，减少横向暴露面。
- 存储并发模型已经去掉全局 `AppStore` 大锁；前台请求直接使用后端自己的并发控制，后台 worker 只共享一个轻量调度闸门，减少高并发下的串行瓶颈。
- API 现在提供了基础稳定性保护，可按需调节：
  - `TMPMAIL_HTTP_REQUEST_TIMEOUT_SECONDS`：限制普通 API 请求最长处理时间，默认 `15`
  - `TMPMAIL_HTTP_CONCURRENCY_LIMIT`：限制同时处理的普通 API 请求数，超过后会快速返回 `503`，默认 `256`
  - `TMPMAIL_SSE_CONNECTION_LIMIT`：限制 `/events` SSE 长连接总数，超过后会快速返回 `503`，默认 `128`
  - `TMPMAIL_PUBLIC_METRICS_ENABLED`：是否公开暴露 `/metrics`，默认 `false`；建议只在受控采集环境里显式开启
  - `TMPMAIL_BACKGROUND_STORE_LOCK_TIMEOUT_MILLISECONDS`：后台 worker 获取共享后台存储调度闸门的等待上限，超时就跳过本轮，避免后台任务扎堆，默认 `250`
  - `TMPMAIL_INBUCKET_REQUEST_TIMEOUT_SECONDS`：限制 Inbucket 拉取、原始邮件下载和附件代理下载的上游超时，默认 `15`
  - `TMPMAIL_INBUCKET_REQUEST_RETRIES`：对 Inbucket 的瞬时失败重试次数，默认 `2`
  - `TMPMAIL_INBUCKET_RETRY_BACKOFF_MILLISECONDS`：Inbucket 重试基础退避时间，默认 `250`
  - `/admin/login`、`/admin/recover`、`/token` 现在带固定窗口暴力破解限流；超过阈值会返回 `429`
  - `/admin/register/otp`、`/accounts/otp` 现在带按 IP 的发送节流；OTP 连续输错过多次后会失效并要求重新申请验证码
- 控制台 session JWT 现在绑定当前密码版本；管理员改密码或通过 recovery 重置密码后，旧 session 会立刻失效，不再等到 TTL 自然过期
  - 前端在改密码成功后会同步清掉 HttpOnly 会话 cookie，并要求重新登录
- Compose 默认只把 API 端口绑定到 `127.0.0.1`：
  - `TMPMAIL_API_BIND_IP=127.0.0.1`
  - `TMPMAIL_FRONTEND_BIND_IP=0.0.0.0`
  - `TMPMAIL_PUBLIC_HOST` 可选，用于让脚本输出稳定的对外访问地址
- API 与前端容器现在默认以非 root 用户运行，并在 compose 里启用了 `no-new-privileges`、`cap_drop: ALL` 和只读根文件系统；如 Linux 下绑定挂载 `./data` 出现权限问题，请把 `TMPMAIL_CONTAINER_UID/TMPMAIL_CONTAINER_GID` 调整为宿主机当前 UID/GID。
- Compose 里的 PostgreSQL 默认只绑定 `127.0.0.1`；未显式设置 `TMPMAIL_POSTGRES_PASSWORD` 时会改由 `secrets-init` 首次生成并持久化，避免把弱默认密码写死在模板里。
- `compose.yaml` 现在会先运行一个一次性的 `secrets-init` 容器：空白的 `TMPMAIL_JWT_SECRET` / `TMPMAIL_POSTGRES_PASSWORD` 会在那里首次生成、写入 `./data/runtime-secrets/`，并打印到该容器日志中。
- 后端默认不会信任客户端自带的 `X-Forwarded-*` / `Forwarded` 头，避免在直接 compose 部署时被伪造 HTTPS、来源 IP 或 Host；只有显式设置 `TMPMAIL_TRUST_PROXY_HEADERS=true` 后，才会按反向代理头解析这些信息。
- API Dockerfile 现在会对 Cargo registry、git 索引和 `target/` 使用 BuildKit cache mount：
  - 首次构建仍需要拉取 Rust 依赖
  - 后续在同一台机器重复构建时会明显更快
  - 如果部署网络访问官方 crates.io 很慢，可在 `.env` 里配置 `TMPMAIL_CARGO_MIRROR=sparse+https://rsproxy.cn/index/`
- `frontend/Dockerfile` 现在会对 npm 缓存使用 BuildKit cache mount，并支持 `TMPMAIL_NPM_REGISTRY`、`TMPMAIL_NPM_FETCH_TIMEOUT`：
  - 国内或受限网络如果卡在 `npm ci`，可在 `.env` 里配置 `TMPMAIL_NPM_REGISTRY=https://registry.npmmirror.com`
  - 因为 lockfile 里写的是 `registry.npmjs.org`，镜像构建会自动启用 `replace-registry-host=always`，确保 tarball 下载也走镜像源
  - 后续在同一台机器重复构建时，npm 依赖会优先命中本地 BuildKit 缓存
- 邮箱 OTP 发信依赖 SMTP 配置：`TMPMAIL_SMTP_HOST`、`TMPMAIL_SMTP_PORT`、`TMPMAIL_SMTP_USERNAME`、`TMPMAIL_SMTP_PASSWORD`、`TMPMAIL_SMTP_FROM_ADDRESS`、`TMPMAIL_SMTP_FROM_NAME`、`TMPMAIL_SMTP_STARTTLS`
- Linux Do OAuth 如需在启动时覆盖 `clientSecret`，可通过 `TMPMAIL_LINUX_DO_CLIENT_SECRET` 提供；运行中的持久化存储在 PostgreSQL
- 前端依赖已经去掉 `latest` 漂移，并通过 lockfile + `overrides` 固定了已验证版本；`npm audit` 当前应为 0 漏洞。
- 邮件原文和附件下载统一走当前 API：
  - `/messages/{id}/raw`
  - `/messages/{id}/attachments/{attachment_id}`
  - 这两个接口都要求账户鉴权，前端不会再直接暴露或访问上游 Inbucket 链接。
- 这一版已经适合做前端主流程联调、容器化测试和单库部署；如果要继续往多实例共享或更强一致性推进，可以在当前 PostgreSQL 基础上再细化锁与并发策略。
