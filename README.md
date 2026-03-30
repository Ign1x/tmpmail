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
   - 本地 HTTP 联调可设 `TMPMAIL_ADMIN_REQUIRE_SECURE_TRANSPORT=false`
   - 如果你希望系统自动生成公网 DNS 方案，保持 `TMPMAIL_MAIL_EXCHANGE_HOST` 和 `TMPMAIL_MAIL_CNAME_TARGET` 为空即可
   - 如果你已经有独立公网收件主机，也可以显式覆盖 `TMPMAIL_MAIL_EXCHANGE_HOST` / `TMPMAIL_MAIL_CNAME_TARGET`

3. 启动服务：

   `./scripts/dev-up.sh`

4. 打开前端：

   `http://127.0.0.1:${TMPMAIL_FRONTEND_PORT}/en`

   如果使用仓库当前 `.env`，就是 `http://127.0.0.1:3001/en`。

5. 跑最小 smoke：

   `./scripts/smoke.sh`

## Admin Domains

- 域名管理现在是管理员流程，不再绑定具体邮箱账户：

  1. 启动服务后打开管理员入口，默认是 `/admin`
  2. 首次进入时设置管理员密码
  3. 系统会自动生成管理员 API Key，并允许复制/轮换
  4. 登录后创建域名、查看 DNS 记录并触发验证
  5. 域名激活后，所有用户都可以直接用它创建邮箱账户

- 管理后台默认入口是 `/admin`，也可通过 `TMPMAIL_ADMIN_ENTRY_PATH` 改成自定义入口。
- 管理台是独立页面，不在主导航里直接暴露。
- 管理台密码保存在 `data/config/admin-state.json`，Compose 默认已挂载 `./data -> /app/data`。
- 业务数据快照默认保存在 `data/storage/store-state.json`，容器重启后会自动恢复域名、账户、邮件和审计数据。
- `TMPMAIL_ADMIN_REQUIRE_SECURE_TRANSPORT` 默认是 `true`；只有本地开发或可信内网测试时才建议关掉。
- 当前端检测到 `TMPMAIL_ADMIN_REQUIRE_SECURE_TRANSPORT=false` 时，`/admin` 页面会允许在本地 HTTP/内网调试环境里直接初始化密码、登录和轮换管理员 Key。
- 管理员 API Key 现在由服务端生成，专门用于系统管理；不再要求前端手动输入。
- `/domains` 旧入口仍然保留，但会重定向到当前配置的管理员入口。
- 后端会按 `TMPMAIL_DOMAIN_VERIFICATION_POLL_INTERVAL_SECONDS` 自动轮询未验证域名。
- 托管域名只有在状态变为 `active` 后才允许所有用户创建邮箱账户。
- 默认 DNS 方案会生成：
  - `TXT _tmpmail-verify.<domain>`
  - `MX <domain> -> mail.<domain>`
  - `mail.<domain>` 的公网路由记录，目标会根据 `TMPMAIL_INBUCKET_BASE_URL` 自动变成 `A`、`AAAA` 或 `CNAME`

如果本机 `8080` 端口已被占用，可以把 API 改到 `18080` 再联调前端，例如：

`TMPMAIL_PORT=18080 cargo run`

前端代理层对应的服务地址可通过 `TMPMAIL_SERVER_API_BASE_URL=http://127.0.0.1:18080` 覆盖。

## Inbucket

远端测试直接用：

`./scripts/inbucket-deploy.sh render`

它会在当前目录生成自包含的 `inbucket.compose.yml` 和 `inbucket.env`，数据目录也固定收口到当前目录下的 `inbucket-data/`。如果你要直接起容器，可以用：

`./scripts/inbucket-deploy.sh up`

这一版 Inbucket 作为统一收件层默认接受所有域名，不把域名列表写死到容器配置里。后续 tmpMail 面板里的加减域名应该由我们自己的后端做验证、入库和放行控制，而不是靠重启 Inbucket。

## Notes

- 当前默认采用“内存仓储 + JSON 快照”模式，服务写操作会自动把状态同步到 `TMPMAIL_STORE_STATE_PATH`。
- 远端 Inbucket 参数已纳入配置层，基础轮询导入已接上；当前仍未切到 PostgreSQL/sqlx，但重启不再丢失业务状态。
- 这一版已经适合做前端主流程联调和容器化测试；如果要多实例共享或做更强一致性，再切 PostgreSQL。
- 前端默认只走本地 `tmpmail` provider；如需对接其他兼容后端，可在设置页手动添加自定义 provider。
