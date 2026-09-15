# ARCHITECTURE · 项目架构

> 给开发者与 Agent：理解「数据存在哪、谁在算、状态怎么流」。

## 总览

pnpm monorepo，三个包 + 顶层脚本/文档：

```
小鳄龙之家（Web 游戏大厅）
├─ packages/rules    纯 TS 规则引擎（零依赖，可独立测试/迁移）
├─ apps/web          React 前端（大厅 + 出包魔法师 UI）
├─ apps/server       Node 服务端（Socket.IO 房间 + 静态托管）
├─ scripts/          打包/部署/截图/回归脚本
└─ docs/             架构/部署/安全/方向文档
```

## 部署形态（数据存储方式）

- **无数据库**：对局即开即散。服务端只持有内存态：`rooms: Map<roomCode, Room>`。
- **权威状态**：联机对局的状态只存在于服务端 Room 内的 `Game` 引擎实例；
  客户端拿到的是 `getView(playerId)` 的**投影视图**，不是全量状态。
- **客户端持久化**：仅浏览器 localStorage 两类键——
  - `tm-settings`：昵称/音效/动画/战报/AI 节奏/服务器地址（个人偏好）
  - `tm-room-tokens`：按房间码存储 `{playerId, name, ts}`（断线重连凭据）
- **前端产物**：`apps/web/dist` 纯静态文件，由服务端同端口托管 → 无独立客户端包。

## 数据流

### 本地单人（浏览器内闭环）

```
GameTable UI ──动作──> useLocalGame(useRef<Game>) ──> packages/rules Game 引擎
     ▲                                                    │
     └──────────── getView('you') 投影视图（setState）◄────┘
AI 回合：useEffect 检测 current.isBot → 延时 chooseAiAction(该玩家视角) → 引擎动作
```

### 联机（权威服务端）

```
浏览器 A/B（GameTable）
   │ declareSpell/endTurn/nextRound（socket.emit）
   ▼
apps/server  Socket.IO
   ├─ listRooms / createRoom / joinRoom(密码校验) / setPassword …
   └─ Room：座位管理、托管策略、房主转移、空房回收
        │
        ▼
   packages/rules Game（每房间一个实例）
        │
        ▼
   broadcastViews()：对每个在线真人 emit 各自 getView(playerId) 的 state
断线：Room 按托管策略延时后以 AI 代打（chooseAiAction 只吃视角，真人回来即接管）
```

### 关键信息模型（规则引擎核心）

- 每个玩家**看不到自己的手牌**、能看到所有他人手牌；弃牌堆公开；牌堆/秘密牌堆只有数量公开；
  自己获得的秘密牌对自己可见，他人秘密牌仅知数量。
- `getView(playerId)` 是这一切的唯一出口；轮末/终局向本人揭晓自己的手牌（复盘）。
- `magicRemaining[magic]`：该玩家视角下每个魔法的剩余张数 = 总张数 − 可见明牌（他人手牌+弃牌+自己秘密牌），因人而异。

## 各包文件与接口说明

### packages/rules

| 文件 | 内容 |
|------|------|
| `types.ts` | 规则常量（36 张牌/8 魔法/HP/8 分制）与全部共享类型（PlayerView/SeatView/RoundResult…） |
| `engine.ts` | `Game` 类：`declareSpell/endTurn/nextRound/getView/startRound`；轮末结算（击杀/全施法/自杀）、猫头鹰加分、胜负判定 |
| `ai.ts` | `chooseAiAction(view, opts)`：超几何推理手牌概率 → 期望收益决策；**只用玩家视角信息** |
| `rng.ts` | `mulberry32`（可复现随机）、`rollD3`、`shuffle` |
| `protocol.ts` | Socket.IO 双向事件类型（ClientToServer/ServerToClient）、房间设置、房间列表项、`GAME_ID` |

对外接口：`getView(playerId)`（投影）、`declareSpell(playerId, magic)`、`endTurn(playerId)`、
`nextRound()`、`chooseAiAction(view)`。所有动作返回 `{ok} | {ok:false, error}`，联机非法输入必须安全拒绝（v8 安全加固）。

### apps/server

| 文件 | 内容 |
|------|------|
| `index.ts` | 入口：express + http + Socket.IO；限流（每 IP 连接/建房、全局房间上限）；CORS 默认同源；静态托管 web/dist + SPA 回退；`/healthz` |
| `room.ts` | `Room` 类：座位/密码/设置（托管策略、AI 节奏）/房主转移/空房回收/托管调度；`listItem()` 供房间列表 |
| `scripts/smoke.mjs` | 端到端冒烟（含密码、恶意 payload、关房用例） |

### apps/web

| 文件 | 内容 |
|------|------|
| `App.tsx` | 页面状态机：首页(小鳄龙之家) → Hall → GameDetail → Local/Online |
| `HallScreen.tsx` / `GameDetailScreen.tsx` | 大厅游戏列表 / 出包魔法师详情（单人设置+联机入口+偏好） |
| `LobbyScreen.tsx` | 房间列表 / 创建加入 / 密码 / 房主设置 |
| `GameTable.tsx` | 对局 UI（本地/联机共用）：座位、魔法栏（剩 N 徽标）、全屏特效、轮末复盘侧栏、日志 |
| `useLocalGame.ts` / `useRemoteGame.ts` | 本地引擎驱动 / Socket.IO 远程驱动，统一为 `GameApi` |
| `components.tsx` / `fx.ts` / `GameSettings.ts` | 卡牌/血条组件、合成音效、设置类型与预设 |
| `GameSettings.ts` | `GameSettings` 类型、AI 节奏预设、默认值（localStorage 持久化） |

## 约束与约定（改动前必读）

1. **信息模型不可破坏**：任何新状态字段都要过 `getView` 投影，禁止把全量状态直接下发。
2. **引擎保持零依赖、可注入随机**：便于单测与未来迁移（如 boardgame.io）。
3. **协议改动 = 双端一起改**：`protocol.ts` 是唯一事件契约；服务端对所有入参做白名单/数值校验。
4. **本地/联机 UI 共用**：新界面逻辑放 `GameTable`/组件，行为差异通过 `GameApi` 适配。

## 新游戏接入指南（平台/游戏两层分离）

> 目的：每款游戏的源码集中在 `games/<id>/`，平台登记入口并绑定其 UI 与联机服务。
> 给 AI 的上下文 = 本文档 + `games/types.ts`（GameModule 契约）+ 一个参考游戏目录（trouble-magician）。

### 目录约定

```
games/
├─ types.ts            GameModule 契约（平台与游戏的唯一接口）
└─ <game-id>/          每个游戏一个目录
   ├─ engine.ts        规则引擎：状态 + apply(playerId, action) + getView(playerId) 投影
   ├─ ai.ts            AI 决策（只用 getView 视角信息）
   ├─ GameUI.tsx       对局界面（本地/联机共用，props 自定）
   ├─ RoomConfig.tsx   房间设置表单（可选）
   └─ index.ts         GameModule 描述符（注册入口）
```

### 接入步骤（checklist）

1. 在 `games/<id>/` 实现引擎与 AI；引擎必须：随机数可注入（可测）、动作入参白名单校验、`getView` 隐藏玩家不可见信息。
2. 写 `index.ts` 导出 `GameModule`（id/name/emoji/mode/人数/描述与适用的引擎／AI 工厂）。
3. 在 `apps/web/src/games.tsx` 的 `GAMES` 数组登记，可填写 cover/tag；大厅按注册表生成可滚动游戏卡片。
4. 在 `App.tsx` 按 gameId 绑定按需加载的 UI。UI 保持独立样式，退出回调返回游戏选择面板。
5. 服务端接入适用的房间处理逻辑。现有 Room 与 RealtimeRoom 保留原协议；已有独立协议的游戏可采用
   暗棋的方式，在同一个 Socket.IO 实例挂载独立命名空间，继续共用网站端口与域名。
6. 将工作区依赖加入 apps 对应的 package.json 和锁文件；Docker 依赖阶段补齐新工作区清单。
   发布脚本已收集整个 games 目录，前端素材随 web dist 分发。
7. 验收：引擎单测 + `pnpm test/typecheck/build` + 冒烟 + 双窗口回归 + 布局 QA。

### 三种模式的平台差异（含 FPS/动作类适配方案）

| 模式 | 数据模式 | 引擎契约 | 平台补充 |
|------|----------|----------|----------|
| turn-based | 事件驱动：动作 → 状态变更 → 广播全量视图 | `apply(playerId, action)` + `getView(playerId)`（现状） | 无 |
| async | 事件驱动 + 状态落库 | 同 turn-based，要求状态可序列化 | 房间持久化 + 通知（需数据库） |
| realtime（FPS/动作） | 时间驱动：服务端 tick 模拟，高频输入、差量快照 | `tick(dtMs)` + `applyInput(playerId, input)` + `getSnapshot()` + `getDelta(lastSeq)` | 20-60Hz tick 循环、差量广播、断线托管改为「站桩/移除」 |

**realtime 接入路线（FPS 立项时执行）**：

1. 原型期：Socket.IO + 服务端 tick（每房间 setInterval 20Hz）广播差量快照；
   客户端只发输入流，本地客户端预测 + 他人插值渲染。2-8 人网页 FPS 足够。
2. 正式期：评估引入 Colyseus（状态补丁同步/插值/重连房间开箱即用），
   大厅与房间管理可保留现有平台，FPS 房间挂 Colyseus。
3. 不建议起步用 WebRTC P2P（作弊面大、主机掉线迁移复杂）。
4. 平台改造点：Room 调度按 mode 分支（事件 vs tick）；GameModule 契约按 mode
   提供 TurnEngine 或 RealtimeEngine；协议新增输入/快照通道；托管策略按模式语义化。

### 给 AI 的上下文模板（开发新游戏时直接粘贴）

> 本项目是小鳄龙之家游戏大厅（monorepo：apps/web 平台壳 + apps/server 平台服务 +
> packages/rules 通用类型 + games/ 游戏目录）。请先读 ARCHITECTURE.md 与
> games/types.ts（GameModule 契约）、参考 games/trouble-magician/ 的实现。
> 任务：在 games/<新游戏id>/ 实现新游戏《XXX》，遵守契约与接入步骤，
> 不修改大厅/房间/连接代码；引擎动作入参必须校验；每个阶段 git 提交并跑全量测试。
