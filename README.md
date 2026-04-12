# TmpMail

TmpMail 是一个临时邮箱服务栈，后端使用 Rust + Axum，前端使用 Next.js App Router，数据存储使用 PostgreSQL，默认通过内置 Inbucket 负责收件。

## 功能概览

- 临时邮箱创建及收件
- 可绑定CF Token 批量添加三级域名
- 可建站给他人使用
- 支持 Linux Do 登录


## 快速开始

1. 克隆仓库并进入目录：

   ```bash
   git clone https://github.com/Ign1x/tmpmail.git
   cd tmpmail
   ```

2. 运行部署脚本：

   ```bash
   ./scripts/dev-up.sh
   ```

   按照提示设置管理员密码和收件域名。

   **执行完毕后，按脚本输出提示为你的域名添加 DNS 记录。**

   如果你愿意，脚本最后还会询问是否顺手清理本次部署产生的 Docker 构建缓存和悬空镜像。

   如果你明确要手动控制容器编排，也可以直接使用：

   ```bash
   docker compose up -d --build
   ```

3. 打开前端 `http://<host>:3000/` 进入统一工作区




