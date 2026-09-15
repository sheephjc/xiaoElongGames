# xiaoelong_web · 1Panel Linux 部署

本次网站独立于桌面组件部署，名称、编排和程序目录使用 `xiaoelong_web`。

| 项目 | 配置 |
| --- | --- |
| 程序目录 | `/opt/xiaoelong_web` |
| 编排与容器名称 | `xiaoelong_web` |
| Node 镜像 | `node:22.23.1-bookworm-slim` |
| pnpm | `11.7.0` |
| 公网端口 / 容器端口 | `3002 / 8080` |
| 临时访问地址 | `http://111.231.19.104:3002/` |
| 数据库预留名称 | `xiaoelong_web` |

当前服务不依赖 MySQL：房间、对局与重连信息存于服务器内存，重启会清空。
数据库仅预留，不写入桌面组件数据库，不伪造存档表或数据库连接。
数据库位于现有 `xiaoelong_home_mysql` MySQL 实例内，已同步至 1Panel 数据库列表；
尚未绑定应用用户，因为当前网站没有数据库连接需求。
网页静态文件和全部游戏 Socket.IO 由同一 Node 进程、同一端口提供服务。

上传 Linux 发布包并解压到 `/opt`，确认 `/opt/xiaoelong_web/apps/web/dist/index.html` 存在，
在服务器终端执行 `sh /opt/xiaoelong_web/install-deps.sh`，安装 Linux 生产依赖。
在 1Panel 容器编排中使用 `/opt/xiaoelong_web/compose.yaml` 创建 `xiaoelong_web`。
放行 TCP 3002 后检查 `/healthz`、`/api/anqi/health`、`/api/mahjong/health`、静态图片和联机。
数据库端口不对公网开放。域名准备好后再配置反向代理和 HTTPS。

部署配置源文件位于 `deploy/1panel/`。更新前保留旧发布包；确认无人对局后停应用，
更新代码并重新执行依赖安装，再启动编排。不要覆盖桌面组件目录或停止其容器。

## 2026-09-15 实际部署记录

- Ubuntu 22.04.4 / Linux x86_64，使用服务器已有 Node 22.23.1 镜像。
- 发布包：`release/xiaoelong_web-20260915.tar.gz`，12,196,201 字节。
- SHA-256：`f2ce6bcc224b926b9500349bde4d73faad0a14be8537850d97bd8dd41152c062`，服务器校验通过。
- 解压至 `/opt/xiaoelong_web`；在 Linux 容器内执行冻结锁文件的生产依赖安装，pnpm 11.7.0 安装成功，未上传 Windows `node_modules`。
- 1Panel 通过路径选择 `/opt/xiaoelong_web/compose.yaml` 创建编排；容器启动并达到 `healthy`，启用 `unless-stopped` 自动重启策略和日志轮转。
- 数据库 `xiaoelong_web` 创建成功并同步至 1Panel；保持 MySQL 仅监听本机端口。
- 用户已在云服务器控制台放行 TCP 3002，公网 HTTP 和 WebSocket 可访问。
- 服务器内和公网的三个健康接口、首页标题、入口 JS/CSS、游戏封面、成员图片、所有 GLB 资源检查通过。
- 公网实测四款游戏建房、加入、开局、断线后恢复通过；出包和鳄龙咆哮同时验证 HTTP polling 与 WebSocket。
- 原桌面组件 `http://111.231.19.104:3001/health` 仍返回 `{"ok":true}`。
- 本次没有网页截图测试，也没有提交 GitHub PR 或推送远程仓库。

公网复查（在本地项目根目录、安装依赖并构建后执行）：

```sh
node scripts/check-deployment.mjs http://111.231.19.104:3002
```

该脚本会创建短暂测试房间：出包、鳄龙咆哮和漳麻结束后主动退出；暗棋断开后由服务器超时回收。
它检查资源与联机协议，不替代浏览器视觉验收。
