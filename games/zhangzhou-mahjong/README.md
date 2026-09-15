# 漳州麻将

源码接入自本地 `Zhangzhou-Mahjong` 项目，原项目保持不变。
十六张、144 张牌，沿用开金、白板代金、吃碰杠胡、补花、抢杠胡、游金、三金倒与原版计分规则。
单机与 1–4 人联机均可从网站游戏大厅进入，空位自动补 AI，最多另有 5 位观战者。

## 目录

- `index.ts`：大厅注册信息。
- `client/`：原生 ES Module 页面、牌桌、音效与单机引擎，在平台内使用 iframe 隔离 DOM 和样式。
- `server/namespace.js`：平台服务器上的房间、凭据、操作验证、按玩家投影和 AI tick。
- `client/src/online-game-engine.js`、`room-reducer.js`：复用的纯联机规则，服务器负责权威推进。
- `tests/`：原版规则回归与真实 Socket.IO 多人测试。

## 运行和构建

在仓库根目录使用锁定的 pnpm 11.7.0：

```sh
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

平台 Vite 插件 `apps/web/mahjong-assets.ts` 开发时提供 `/mahjong/` 文件，
构建时自动写入 `apps/web/dist/mahjong/`，发布包和 Docker 包含完整工作区。
游戏入口与封面使用平台 BASE_URL，页面内部使用相对素材路径，联机共用平台 `/socket.io` 端点。
游戏菜单按需加载，原生页面保持独立，不向其他游戏注入样式。

## 联机

Socket.IO 命名空间 `/zhangzhou-mahjong`；健康检查 `/api/mahjong/health`。
无需 Firebase 配置、数据库、SDK 或客户端房主循环。
原 Firebase 留言板和线上调试入口不在本次游戏入口中。

服务器创建随机身份与 192 位重连凭据；浏览器会话存储保留身份、房间和座位。
客户端只能提交自己座位的操作，摸牌与补牌由服务器自动处理；
服务器验证回合、响应优先级、手牌位置、吃牌组合、杠牌和胡牌条件，拒绝过期版本并去除重复动作。
牌墙、其他玩家暗牌、暗杠牌面和响应选项不会下发；观战者在终局前也看不到暗牌。
掉线座位由 AI 接管，重连后恢复手动操作，房主离线时转交给在线座位。
全部成员断线 15 分钟后回收房间；最后一位成员主动离开时立即销毁。
房间与凭据存于内存，服务重启后重新建房，与平台其他游戏的部署方式一致。

接入时修复原单机音效拆分后 `primeActionVoiceEngine` 缺少导入导致无法开局的问题。
手机可以使用竖屏牌桌，不强制旋转屏幕；平台返回按钮始终位于游戏页面外侧。

## 验证

```sh
pnpm --filter @tm/game-zhangzhou-mahjong test
node scripts/qa-mahjong.mjs http://127.0.0.1:5173
```

浏览器脚本只检查游戏流程，不产生截图。
概念封面位于 `apps/web/public/hall/cover-zhangzhou-mahjong.png`，
内置 imagegen 完整提示词见 `docs/zhangzhou-mahjong-image-prompt.txt`。
