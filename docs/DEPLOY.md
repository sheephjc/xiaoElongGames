# 服务端部署指南（腾讯云）

当前实际运行的 Linux / 1Panel 部署配置、访问地址和验证记录见 [DEPLOY-1PANEL.md](DEPLOY-1PANEL.md)。

《小鳄龙之家》游戏大厅是**单进程服务**：完整大厅（《出包魔法师》桌游 +
《鳄龙咆哮》3D FPS +《暗棋》双人对弈 +《漳州麻将》）+ Socket.IO 对战 + 同端口托管前端静态产物，
一个端口即可上线。客户端无需单独部署（浏览器访问即客户端）；
另有「双击即玩」的本地客户端包，见 README「本地单机入口」。

> 只想免费部署**单人 vs AI**（不需要联机）？走 GitHub Pages 纯静态托管即可，
> 无需任何服务器，见 [GITHUB-PAGES.md](GITHUB-PAGES.md)。

## 1. 支持的系统与环境依赖

| 项 | 要求 |
|----|------|
| 操作系统 | 任意主流 Linux（Ubuntu 20.04+/Debian 11+/CentOS Stream 8+）；macOS 亦可（开发/自用） |
| Node.js | ≥ 22.13（Docker 镜像使用 Node 22 / Alpine 3.22） |
| pnpm | 11.7.0（corepack 自动启用仓库锁定版本） |
| 内存 | 512MB 以上（对局无持久化，内存占用很低；Docker 构建期建议 ≥ 1GB 或配 swap） |
| 网络 | 放行一个 TCP 端口（默认 8080/8787，按你的配置） |

## 2. 部署方式总览

Docker 构建的依赖、前端构建和运行阶段均包含完整游戏工作区，避免 `workspace:*` 包缺失。
运行时仍由单个 Node 进程同源托管前端与 Socket.IO，不需要部署第二个客户端服务。
暗棋挂载在同一个 Socket.IO 服务的 `/anqi` 命名空间，不需要额外的 3001 端口。
其健康检查是 `/api/anqi/health`，开发时由 Vite 代理到同一个平台服务。
漳州麻将使用 `/zhangzhou-mahjong` 命名空间与 `/api/mahjong/health` 健康检查。
原版网页素材由前端构建自动复制到 `dist/mahjong/`，服务器规则位于游戏工作区；
无需 Firebase 配置、认证 SDK 或数据库。房间与重连凭据保存在服务器内存中，重启后重新建房。
从 Windows 检出到 Linux 时，仓库 `.gitattributes` 保证 Shell 脚本使用 LF；
部署脚本也可使用 `bash scripts/deploy.sh` 执行，不依赖 Windows 下的执行权限。

| 方式 | 适合 | 说明 |
|------|------|------|
| A. 发布包（推荐） | 想快速上线、不熟 Docker | `scripts/pack-release.mjs` 打一个 tar.gz，解压即跑 |
| B. Docker Compose | 追求环境隔离 | 仓库自带 Dockerfile/compose |
| C. 源码 + systemd | 要常驻、便于改代码 | 裸机 Node + systemd 单元 |

> 无论哪种方式，先在腾讯云控制台放行端口：
> 轻量应用服务器 →「防火墙」；CVM →「安全组」。入站 TCP 放行你的服务端口。

## 3. 方式 A：发布包部署（推荐）

```bash
# ---- 本地（开发机）打包 ----
node scripts/pack-release.mjs
# 产物：release/trouble-magician-<版本>.tar.gz
# 内容：完整游戏大厅（前端 dist + 服务端源码 + 全部 workspace 游戏包 + 文档），
#      解压后即包含大厅里的两款游戏；大小约 20MB（主要是 3D 模型）。

# ---- 上传到服务器 ----
scp release/trouble-magician-<版本>.tar.gz ubuntu@<服务器IP>:~/

# ---- 服务器上 ----
# 3.1 安装 Node 22 + 启用 pnpm（已有则跳过）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs
sudo corepack enable && corepack prepare pnpm@11.7.0 --activate

# 3.2 解压安装（只装生产依赖）
tar xzf trouble-magician-<版本>.tar.gz
cd trouble-magician-<版本>
pnpm install --frozen-lockfile --prod

# 3.3 前台试跑验证
PORT=8080 HOST=0.0.0.0 pnpm --filter @tm/server start
# 另开终端：curl http://127.0.0.1:8080/healthz  → {"ok":true,...}

# 3.4 常驻（systemd）：创建 /etc/systemd/system/tm-server.service，内容：
cat <<'EOF' | sudo tee /etc/systemd/system/tm-server.service
[Unit]
Description=Trouble Magician game server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/trouble-magician-<版本>
Environment=PORT=8080
Environment=HOST=0.0.0.0
ExecStart=/usr/bin/pnpm --filter @tm/server start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
# 按实际路径修改 User/WorkingDirectory 后：
sudo systemctl daemon-reload && sudo systemctl enable --now tm-server
journalctl -u tm-server -f    # 看日志
```

## 4. 方式 B：Docker Compose

```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker

# 上传代码（git clone 或 rsync，或直接上传 release tar 包后自行构建镜像）
cd <项目目录>
docker compose up -d --build     # 端口映射 8080:8080（见 docker-compose.yml）
curl http://127.0.0.1:8080/healthz
```

## 5. 方式 C：源码 + systemd（systemd 单元内容见方式 A 3.4 节，按路径修改）

```bash
git clone <仓库> && cd <仓库>
pnpm install --frozen-lockfile
pnpm --filter @tm/web build
# 然后创建 systemd 单元（内容见上方 3.4 节）并 enable --now
```

## 6. 配置项

| 环境变量 | 默认 | 说明 |
|----------|------|------|
| `PORT` | 8787 | 服务端口（发布包/生产常用 8080） |
| `HOST` | 0.0.0.0 | 监听地址；只走 nginx 反代时设 `127.0.0.1` 更安全 |
| `CORS_ORIGIN` | 空 | 跨源白名单（逗号分隔）。默认仅同源；**前后端分离部署**时填前端域名 |
| `TRUST_PROXY` | 空 | 仅当部署在可信反代（nginx/caddy）后置 `1`，才允许 `X-Forwarded-For` 参与限流；直连暴露时必须保持空，否则可被伪造绕过限流 |

> 客户端侧配置（服务器地址）在页面「联机大厅 → 服务器地址」填写，同源部署留空即可。

## 7. 部署后自检（测试清单）

安全边界与加固清单见 [SECURITY.md](SECURITY.md)，上线前建议额外执行
`pnpm --filter @tm/server exec node scripts/security-smoke.mjs`。

```bash
# 1) 健康检查
curl http://127.0.0.1:<端口>/healthz        # {"ok":true,"rooms":0,...}

# 2) 页面与静态资源
curl -I http://127.0.0.1:<端口>/            # 200，text/html

# 3) 端到端冒烟（推荐在开发机执行；服务器 --prod 安装不含 socket.io-client 等 devDeps）
node apps/server/scripts/smoke.mjs http://127.0.0.1:<端口>
node apps/server/scripts/smoke-realtime.mjs http://127.0.0.1:<端口>
# 预期：建房→密码校验→开局→终局→断线重连→关房 / realtime 快照冒烟，全部 ✅

# 4) 浏览器实测：两个设备/窗口分别建房与加入，能进入对局即为通过
```

## 8. 域名 + HTTPS（可选）

1. 域名 A 记录解析到服务器公网 IP。
2. `sudo apt install -y nginx`，创建 `/etc/nginx/sites-available/tm`（含 WebSocket 两条头），内容：

```nginx
server {
    listen 80;
    server_name tm.example.com;   # ← 改成你的域名

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:8787;   # ← 改成服务端实际端口
        proxy_http_version 1.1;

        # Socket.IO 必需的两条头
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }
}
```

3. `sudo ln -s /etc/nginx/sites-available/tm /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx`。
4. `sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d 你的域名`。
5. 防火墙放行 80/443；游戏端口可改为仅本机监听（`HOST=127.0.0.1`）。

## 9. 常见问题

| 现象 | 处理 |
|------|------|
| 部署成功但外网访问不了 | 检查腾讯云防火墙/安全组是否放行端口 |
| 构建 OOM（小内存机） | `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`（并写入 /etc/fstab） |
| WebSocket 失败（nginx 场景） | 确认含 `Upgrade`/`Connection` 两条头 |
| 端口被占用 | `lsof -i :<端口>` 找到进程处理 |
| 想换端口 | 改 `PORT` 环境变量（docker-compose/systemd/启动命令），并同步防火墙 |
| 想限制暴露面 | 服务端已内置每 IP 连接/建房上限与全局房间上限 |

## 10. 升级更新

- 发布包：重新 `pack-release.mjs` → 上传覆盖解压 → `systemctl restart tm-server`。
- Docker：`git pull && docker compose up -d --build`。
- 注意：对局无持久化，重启会清空进行中的房间（属预期）。
