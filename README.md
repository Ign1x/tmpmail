# TmpMail Minimal Stack

当前目录提供的是第一版最小可部署实现：

- 一个可运行的 Rust API 服务
- 一个可直接联调的 Next.js 前端
- 一套 Docker 镜像与 `compose.yaml`
- 一个单文件 Inbucket 部署脚本
- 预留远端 Inbucket 接入参数，便于后续收件链路接入
- 已接入管理员域名后台、全局域名管理、DNS 配置展示和手动/自动验证

## Quick Start

1. 复制环境变量模板：

   `cp .env.example .env`

2. 编辑 `.env`，至少确认以下字段：

   - `TMPMAIL_PUBLIC_DOMAINS`
   - `TMPMAIL_JWT_SECRET`
   - `TMPMAIL_INBUCKET_BASE_URL`
   - `TMPMAIL_INGEST_MODE=remote-inbucket`
   - `TMPMAIL_STORE_STATE_PATH`
   - 如果要切到 PostgreSQL，把 `TMPMAIL_DATABASE_URL` 指向你的数据库；为空时继续使用本地 JSON 快照仓储
   - 本地 HTTP 联调可设 `TMPMAIL_ADMIN_REQUIRE_SECURE_TRANSPORT=false`
   - 推荐配置一个稳定共享收件主机，例如 `TMPMAIL_MAIL_EXCHANGE_HOST=mail.fuckmail.online`
   - 再用 `TMPMAIL_MAIL_CNAME_TARGET` 指向该主机的公网 IP 或上游主机名
   - 配置后，托管域名会统一生成 `CNAME mail.<domain> -> <共享收件主机>`、`MX <domain> -> <共享收件主机>`、`TXT <domain> -> <verification token>`
   - 如果保持 `TMPMAIL_MAIL_EXCHANGE_HOST` 为空，系统会回退为每个域名自己的 `mail.<domain>` 路由

3. 启动服务：

   `./scripts/dev-up.sh`

4. 打开前端：

   `http://<your-host-ip>:${TMPMAIL_FRONTEND_PORT}/en`

   如果使用仓库当前 `.env`，当前机器上就是 `http://10.250.50.235:3001/en`。

   管理台入口：

   `http://<your-host-ip>:${TMPMAIL_FRONTEND_PORT}/admin`

5. 跑最小 smoke：

   `./scripts/smoke.sh`

## PostgreSQL

- 现在已经支持可选的 PostgreSQL + `sqlx` 仓储。
- 不设置 `TMPMAIL_DATABASE_URL` 时，服务继续使用当前的 `MemoryStore + JSON 快照` 模式。
- 设置 `TMPMAIL_DATABASE_URL` 后，服务启动时会自动执行 `migrations/` 下的建表迁移，并把域名、账户、消息、导入去重键和审计日志落到 PostgreSQL。
- 如果 PostgreSQL 当前还是空库，而 `TMPMAIL_STORE_STATE_PATH` 指向的 JSON 快照存在，服务会在首次启动时自动把快照导入 PostgreSQL，避免切库时丢历史数据。
- `/readyz` 现在会真实检查当前存储后端；Memory 模式直接就绪，PostgreSQL 模式会实际执行数据库探测。Compose 也已改为用它做 API 健康检查。
- 仓库自带了一个可选 Compose profile：

  `docker compose --profile postgres up -d postgres`

- 对应本地默认连接串可以直接写成：

  `TMPMAIL_DATABASE_URL=postgres://tmpmail:tmpmail@127.0.0.1:5432/tmpmail`

## Admin Domains

- 后台现在是独立的 console 用户体系，默认入口仍是 `/admin`：

  1. 首次进入时先创建第一个管理员用户名和密码
  2. 之后所有后台成员都通过“用户名 + 密码”登录
  3. 角色分为 `admin` 和 `user`
  4. `admin` 可以管理后台用户、每个用户可添加的域名数量、系统启停状态、共享收件主机配置、日志与清理任务
  5. `user` 可以获取自己的后台 API Key、添加域名、查看 DNS 记录、执行域名验证

- 管理后台默认入口是 `/admin`，也可通过 `TMPMAIL_ADMIN_ENTRY_PATH` 改成自定义入口。
- 管理台是独立页面，不在主导航里直接暴露。
- 如设置 `TMPMAIL_ADMIN_PASSWORD`，服务启动时会确保存在一个默认管理员用户 `admin`，适合本地测试或一键初始化。
- 控制台用户、密码哈希、后台 API Key 哈希和系统设置保存在 `data/config/admin-state.json`，Compose 默认已挂载 `./data -> /app/data`。
- 如果忘记管理员密码，可临时设置 `TMPMAIL_ADMIN_RECOVERY_TOKEN`，然后在 `/admin` 页面按用户名使用恢复令牌重置密码。恢复成功后会同时轮换新的后台 Key。恢复令牌不会落盘，建议只在可信环境短暂启用，用完立刻删除。
- 业务数据快照默认保存在 `data/storage/store-state.json`，容器重启后会自动恢复域名、账户、邮件和审计数据。
- `TMPMAIL_ADMIN_REQUIRE_SECURE_TRANSPORT` 默认是 `true`；只有本地开发或可信内网测试时才建议关掉。
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

远端测试直接用：

`./scripts/inbucket-deploy.sh render`

它会在当前目录生成自包含的 `inbucket.compose.yml` 和 `inbucket.env`，数据目录也固定收口到当前目录下的 `inbucket-data/`。如果你要直接起容器，可以用：

`./scripts/inbucket-deploy.sh up -sd mail.your-domain.tld -ip your.server.ip`

这一版 Inbucket 作为统一收件层默认接受所有域名，不把域名列表写死到容器配置里。后续 tmpMail 面板里的加减域名应该由我们自己的后端做验证、入库和放行控制，而不是靠重启 Inbucket。

脚本在 `render` / `up` 完成后会直接打印 Cloudflare 需要填写的稳定收件主机 `A` 记录，以及后续每个业务域名都要复用的 `MX/TXT` 模板。

注意：

- 如果这个 Inbucket 要作为公网 MX 收件主机，宿主机必须对外开放 `25/TCP`，并把它映射到容器内的 `2500`。
- 外部邮件服务器只会对 MX 主机发起 `25/TCP` 连接，不会改连 `2500`。
- `2500` 只适合本地联调或内网测试；拿它直接做公网 MX 时，发件方通常会报“对方服务器未响应”或持续重试。

## Notes

- 当前默认采用“内存仓储 + JSON 快照”模式，服务写操作会自动把状态同步到 `TMPMAIL_STORE_STATE_PATH`。
- 如果配置了 `TMPMAIL_DATABASE_URL`，业务数据会改为存入 PostgreSQL，JSON 快照路径仅继续用于未切库环境。
- 远端 Inbucket 参数已纳入配置层，基础轮询导入已接上；无论使用 JSON 快照还是 PostgreSQL，重启后都能恢复业务状态。
- API 现在提供了基础稳定性保护，可按需调节：
  - `TMPMAIL_HTTP_REQUEST_TIMEOUT_SECONDS`：限制普通 API 请求最长处理时间，默认 `15`
  - `TMPMAIL_HTTP_CONCURRENCY_LIMIT`：限制同时处理的普通 API 请求数，超过后会快速返回 `503`，默认 `256`
  - `TMPMAIL_BACKGROUND_STORE_LOCK_TIMEOUT_MILLISECONDS`：后台 worker 获取全局存储锁的等待上限，超时就跳过本轮，避免和前台请求长期互相阻塞，默认 `250`
  - `TMPMAIL_INBUCKET_REQUEST_TIMEOUT_SECONDS`：限制 Inbucket 拉取、原始邮件下载和附件代理下载的上游超时，默认 `15`
  - `TMPMAIL_INBUCKET_REQUEST_RETRIES`：对 Inbucket 的瞬时失败重试次数，默认 `2`
  - `TMPMAIL_INBUCKET_RETRY_BACKOFF_MILLISECONDS`：Inbucket 重试基础退避时间，默认 `250`
- Compose 默认只把 API 端口绑定到 `127.0.0.1`：
  - `TMPMAIL_API_BIND_IP=127.0.0.1`
  - `TMPMAIL_FRONTEND_BIND_IP=0.0.0.0`
  - `TMPMAIL_PUBLIC_HOST` 可选，用于让脚本输出稳定的对外访问地址
- 邮件原文和附件下载统一走当前 API：
  - `/messages/{id}/raw`
  - `/messages/{id}/attachments/{attachment_id}`
  - 这两个接口都要求账户鉴权，前端不会再直接暴露或访问上游 Inbucket 链接。
- 这一版已经适合做前端主流程联调、容器化测试和单库部署；如果要继续往多实例共享或更强一致性推进，可以在当前 PostgreSQL 基础上再细化锁与并发策略。
