# 漳州麻将 Linux 验证

日期：2026-09-14。仅本机 Docker 验证，未部署服务器，未执行截图测试。

## 环境和镜像

- Docker Desktop Linux Engine 29.6.1。
- Node 22.22.3 / Alpine 3.22，锁定 pnpm 11.7.0。
- 镜像：`xiaoelong-mahjong:ui-local`。
- 镜像 ID：`sha256:dcf16ed3fed74de73d7a86c3837c5b9088a7fa0427dbfe7c8987eac119c91ec7`。
- 首次构建新工作区时分别下载、安装 274 项构建依赖和 100 项生产依赖，使用冻结锁文件；构建阶段包含所有游戏工作区。
- Docker 构建、Vite 构建与生产依赖安装通过；复核构建真实进程退出码为 0。
- 临时容器 `xiaoelong-mahjong-check-0914`，只映射本机 `127.0.0.1:8800 → 8080`。

## 漳麻规则与联机

容器内执行 `games/zhangzhou-mahjong/tests/run-all.mjs`，通过四套原规则检查：
room reducer、单机引擎、动作一致性和联机稳定性。
测试辅助依赖 Socket.IO 客户端复用镜像中前端工作区的已有生产依赖。

真实 Socket.IO 多人检查通过：建房、四人入座、观战、房主权限、暗牌／牌墙／暗杠隔离、
越权与非法摸牌拒绝、重复和过期操作、掉线 AI 接管、凭据重连、AI 完整终局、
分数守恒、下一局与最终房间回收。

## 生产网页与静态资源

`node scripts/qa-mahjong.mjs http://127.0.0.1:8800` 通过：
大厅进入、单机开局、同源创建／加入／开局／开金、触屏手机刷新恢复、离开与返回。
无页面 JavaScript 异常，无 Firebase 网络请求，未产生截图。

以下请求通过：

- `/healthz`：`ok: true`。
- `/api/mahjong/health`：`ok: true`，流程结束后 `rooms: 0`。
- `/hall/cover-zhangzhou-mahjong.png`：200。
- `/mahjong/src/server-client.js`：200。
- `/socket.io/socket.io.js`：200。
- `hero-barbarian-Cg69yYuF.glb`：200，3,613,268 字节，GLB 文件头有效。
- `blaster-a-CjXm9ItO.glb`：200，55,204 字节，GLB 文件头有效。

## 原游戏回归

在同一个 Linux 生产容器执行客户端联机冒烟：

```sh
node apps/server/scripts/smoke.mjs http://127.0.0.1:8800
node apps/server/scripts/smoke-realtime.mjs http://127.0.0.1:8800
```

出包魔法师通过密码与列表、托管设置、非法载荷、完整终局、重连与最终房间关闭。
鳄龙咆哮通过建房／加入、英雄选择、实时快照、输入回执、非法输入拒绝、
掉线 AI 接管、重连和自然终局。两条脚本均退出码 0。

测试结束后停止临时容器；开发预览仍使用 `5173` 与 `8787`。

本机完整构建输出保存在 `output/playwright/linux-mahjong-build.log`，
构建退出码复核日志为 `output/playwright/linux-mahjong-build-verified.log`。
这些运行日志为本地产物，文档中的检查记录随代码分发。
