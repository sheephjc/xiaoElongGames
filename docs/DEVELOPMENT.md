# 🛠 开发手册（从安装到打包）

> 这是新开发者第一天需要读的唯一文档：环境 → 依赖 → 目录 → 测试 → 联调 →
> 调校 → 打包。架构细节见 [ARCHITECTURE.md](ARCHITECTURE.md)，部署见 [DEPLOY.md](DEPLOY.md)。

## 1. 环境与依赖

- Node.js ≥ 22.13；pnpm 11.7.0（corepack 可自动启用锁定版本）。
- 一次性安装全部依赖（工作区 + three/tweakpane/playwright 等）：

```bash
pnpm install
npx playwright install chromium   # 仅跑截图/回归脚本时需要
```

- 依赖关系（workspace）：
  - `apps/web` → `@tm/game-trouble-magician`、`@tm/game-corcodragon-fight`、`@tm/rules`、react、vite、socket.io-client
  - `apps/server` → `@tm/game-corcodragon-fight`、`@tm/rules`、express、socket.io、tsx
  - `games/corcodragon-fight` → `three`（渲染）、`tweakpane`（调试面板，按需分包）
  - 游戏引擎（`games/corcodragon-fight/engine|ai|defs|balance`）保持零运行时依赖，可独立测试。

## 2. 目录速览

```
apps/web       大厅 UI（平台壳，不含具体游戏逻辑）
apps/server    Socket.IO 服务端 + 静态托管
packages/rules 出包魔法师规则引擎 + 协议类型（零依赖）
games/types.ts 平台↔游戏契约
games/*        游戏子项目（引擎/描述符/UI；禁止反向 import apps）
docs/          官方文档；docs-dev/ 本地开发资料（gitignore）
scripts/       打包、冒烟、截图、双窗口、布局 QA
```

## 3. 日常命令

```bash
pnpm dev               # 前端 5173 + 服务端 8787（前端已代理 /socket.io）
pnpm test              # 全工作区单测（规则/出包/鳄龙咆哮/服务端安全）
pnpm typecheck         # 全工作区 TS 类型检查
pnpm build             # 构建可发布的前端 dist
pnpm --filter @tm/server test          # 服务端安全基元单测
pnpm --filter @tm/game-corcodragon-fight test   # FPS 引擎+配置层测试
pnpm --filter @tm/web preview          # 本地预览生产构建
```

联机端到端（先启动服务端）：

```bash
node apps/server/scripts/smoke.mjs http://127.0.0.1:8787   # 出包魔法师联机冒烟
node apps/server/scripts/smoke-realtime.mjs                # 鳄龙咆哮 realtime 冒烟
node scripts/e2e-twowindow.mjs                             # 出包双窗口回归
node scripts/e2e-twowindow-corcodragon.mjs                 # FPS 双窗口回归
node scripts/qa-layout.mjs                                 # 出包布局 QA
node scripts/qa-layout-corcodragon-fight.mjs               # FPS 三档布局 QA
```

FPS 专属：

```bash
node scripts/smoke-corcodragon-fight.mjs          # 本地冒烟+截图（TM_MODE=tdm|training 可选）
node scripts/smoke-tuning.mjs                     # ?debug=1 调参面板冒烟
```

截图与识图结果写入 `docs-dev/`（本地，gitignore）。

## 4. 手动调校数值

- 全部手感/战斗数值在 `games/corcodragon-fight/gameplay.json`；
  加载/校验/热更新在 `games/corcodragon-fight/balance.ts`。
- 本地对局 URL 加 `?debug=1`：右侧 tweakpane 实时拖杆（移动/武器/英雄/技能/碰撞盒），
  导出 `gameplay.tuned.json` 回写即可。
- 训练场：详情页选「训练场」，打四种靶子看命中率/爆头率。
- 完整流程见 [GAMEPLAY-TUNING.md](GAMEPLAY-TUNING.md) 与 [SHOOTING-FEEL.md](SHOOTING-FEEL.md)。

画质与帧率：

- 服务端权威模拟频率可在详情页/联机房间选择 **20/30/60Hz（默认 30Hz）**；
  引擎步长 `tickStepMs` 每房间独立，服务端 tick 循环按房间步长运行；
  20Hz=省资源、30Hz=推荐、60Hz=最顺滑（局域网）。
- 浏览器渲染仍为 rAF（目标 60fps），与服务端模拟频率相互独立；
- URL 加 `?quality=low` 流畅优先（关阴影/降分辨率/去尘埃），`?quality=high` 画质优先；
  缺省为自动：连续低帧会自动关阴影、降像素比；
- `?debug=1` 左上角可查看实时 `fps`、ping、漂移与待确认输入数。

## 5. 客户端（前端）部署

- `apps/web` 是纯静态产物：`pnpm build` 生成 `apps/web/dist`；
- 由服务端同端口托管（生产默认），无独立客户端包；
- 纯本地单机包：`node scripts/pack-local.mjs`（产物在 `release/`，用系统 Python 托管，127.0.0.1:8123）；
- 局域网联机：前端 dev 默认 `host:true`，他人访问 `http://<主机IP>:5173`；生产则访问服务端端口。

## 6. 服务端部署

- `pnpm --filter @tm/server start`（开发用 tsx 直跑；生产见 [DEPLOY.md](DEPLOY.md) 的 Docker/systemd 方案）；
- 环境变量：`PORT`（默认 8787）、`HOST`（默认 0.0.0.0）、`CORS_ORIGIN`（跨域白名单，默认同源）、
  `TRUST_PROXY`（只有部署在可信反代后置 1，才允许 X-Forwarded-For 参与限流）；
- 发布包：`node scripts/pack-release.mjs`。

## 7. 上线前检查清单

```bash
pnpm test && pnpm typecheck && pnpm build
node apps/server/scripts/smoke.mjs
node apps/server/scripts/smoke-realtime.mjs
node scripts/e2e-twowindow-corcodragon.mjs
```

安全边界与已知取舍见 [SECURITY.md](SECURITY.md)。
