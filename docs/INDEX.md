# 📚 小鳄龙之家 · 文档索引

> 仓库文档分类原则：
> - `docs/`：**官方文档**（架构/玩法/部署/开发），随 git 分发；
> - `docs-dev/`：**开发期本地资料**（截图、风险日志、规划、识图报告、历史归档），
>   已在 `.gitignore` 中，不随仓库分发；
> - `tools/`：脚本与本地机密（API key、素材归档），已在 `.gitignore` 中。

## 项目从属关系

```
小鳄龙之家（游戏大厅平台）
├─ apps/web         平台壳：大厅 / 房间 / 对局容器（React + Vite）
├─ apps/server      平台服务：Socket.IO 房间、tick 循环、静态托管
├─ packages/rules   平台共享：出包魔法师规则引擎与协议类型（零依赖）
├─ games/types.ts   平台 ↔ 游戏的唯一契约（GameModule / RealtimeGameEngine）
└─ games/<game-id>/ 游戏子项目（只被平台依赖，禁止反向依赖 apps）
   ├─ trouble-magician    第一款游戏（回合制桌游）
   ├─ corcodragon-fight   鳄龙咆哮（3D 实时 FPS）
   ├─ anqi               暗棋（双人本地同屏 / 同源联机）
   ├─ zhangzhou-mahjong   漳州麻将（单机 / 1–4 人服务器联机）
   └─ corcodragon-fire    已归档的鳄龙战场（available=false，保留代码）
```

依赖方向（单向）：`apps → games → games/types`，`apps/server → @tm/rules`；
`games` 不得 import `apps`，`packages/rules` 不得 import `games`。
详见 `docs/ARCHITECTURE.md`。

## 官方文档索引（docs/）

| 我想了解 | 读这里 |
|----------|--------|
| 整体架构、数据流、目录、接入 checklist | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 从零装环境、跑测试、构建、打包 | [DEVELOPMENT.md](DEVELOPMENT.md) |
| 服务端/客户端部署、环境变量、运维 | [DEPLOY.md](DEPLOY.md) |
| 首页场景、面板交互、UI 回归与 Linux 验证 | [UI.md](UI.md) |
| 出包魔法师完整规则 | [出包魔法师桌游基本规则.md](出包魔法师桌游基本规则.md) |
| 实时 FPS 通道设计（tick/快照/回执/断线） | [REALTIME.md](REALTIME.md) |
| 战斗判定与弹道算法 | [COMBAT.md](COMBAT.md) |
| 射击手感调校与训练场验证 | [SHOOTING-FEEL.md](SHOOTING-FEEL.md) |
| 手动调数值（gameplay.json + `?debug=1` 面板） | [GAMEPLAY-TUNING.md](GAMEPLAY-TUNING.md) |
| 素材来源、许可、已接入资产与替换计划 | [ASSETS.md](ASSETS.md) |
| 服务端安全边界与加固清单 | [SECURITY.md](SECURITY.md) |

## 本地开发资料（docs-dev/，不进 git）

| 资料 | 位置 |
|------|------|
| UI/联机/技能截图与回归截图 | `docs-dev/screenshots/` |
| 操作风险日志（端口/外网/安装等记录） | `docs-dev/RISK_LOG.md` |
| 开发规划与路线 | `docs-dev/CORCODRAGON-ROADMAP.md` |
| Agent 工作记忆 | `docs-dev/AGENT_MEMORY.md` |
| 视觉模型识图结果 | `docs-dev/vision-results/`（符号链接到 `tools/vision-results/`） |
| 已归档的旧需求/历史资料 | `docs-dev/archive/` |

> 更新日志仍放仓库根目录 `CHANGELOG.md`（随版本分发）；仓库根 `README.md` 是入口。
