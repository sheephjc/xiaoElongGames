# 暗棋 · Web 对战版

一款基于中国象棋棋盘的双人暗棋变体，支持本地同屏和四位房间号联机对战。联机模式由服务端保存暗棋身份并权威裁决落子。

## 在小鳄龙网站运行

```bash
pnpm install
pnpm dev
```

在小鳄龙网站仓库根目录执行，访问 `http://127.0.0.1:5173`，从游戏大厅进入暗棋。
暗棋 UI 按需加载，内部页面使用 MemoryRouter；退出回到网站游戏选择面板。
联机使用平台 8787 服务的 `/anqi` Socket.IO 命名空间，不需要独立的 3001 服务。

生产环境从仓库根目录执行：

```bash
pnpm build
pnpm --filter @tm/server start
```

Windows 没有全局 pnpm 时，可使用仓库锁定版本：

```powershell
npx.cmd --yes pnpm@11.7.0 install
npx.cmd --yes pnpm@11.7.0 dev
```

## 检查与测试

```bash
pnpm --filter @tm/game-anqi typecheck
pnpm --filter @tm/game-anqi test
node scripts/qa-anqi.mjs
node scripts/qa-home.mjs
pnpm build
```

浏览器回归脚本从网站大厅真实进入游戏，检查本地落子、双人同步和刷新后重连。
刷新后重新进入暗棋，可点击「继续房间」恢复 60 秒内保留的联机棋局。
开发模式可通过网站网址上的 `?seed=42` 使用固定洗牌；生产构建忽略该参数。

## 结构

- `src/game/`：不依赖 React 的规则、状态、合法走法和公开状态投影。
- `src/components/`：棋盘、俘虏区和规则界面。
- `src/online/`：联机客户端状态与共享 Socket.IO 协议。
- `server/namespace.ts`：挂载已有 Socket.IO 命名空间，内存房间、断线恢复和服务端权威棋局。
- `server/createServer.ts`：单元测试用独立服务器，不用于网站生产启动。
- `apps/web/public/anqi/assets/pieces/`：本地化并重新着色的 CC0 棋子 SVG，经 Vite BASE_URL 加载。
- `src/styles.css`：限定在 `.anqi-game` 内，动画名也使用独立前缀。
- `tests/`：原项目规则、组件与服务端测试，以及防止重复绑定连接的回归。

来源：`D:/Desktop/HJC/暗棋` 工作区。复制接入，原目录未修改。
概念封面由内置 imagegen 生成，保存到 `apps/web/public/hall/cover-anqi.png`；
完整提示词保存在 `docs/anqi-image-prompt.txt`。
只部署前端静态文件时本地同屏可用，暗棋联机需要同源平台服务。

第三方视觉素材的来源和许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
