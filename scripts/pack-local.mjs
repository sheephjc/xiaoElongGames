/**
 * 单机版打包脚本：产出「双击即玩」的本地包（不需要 Node/pnpm）。
 *
 * 这是**完整游戏大厅**的客户端包：内含《出包魔法师》（桌游）与
 * 《鳄龙咆哮》（3D FPS，含全部英雄/枪械/地图模型）与《暗棋》本地同屏及其大厅。
 * 原理：单人 vs AI 模式的规则引擎完全在浏览器内运行，不依赖任何游戏服务端；
 * 本地包只需托管静态文件（apps/web/dist），用系统自带的 python 起一个
 * 仅本机可访问的极轻静态服务器（127.0.0.1:8123），双击启动脚本即可打开。
 * 出包与鳄龙咆哮联机可填公网服务地址；暗棋在纯静态包中仅支持本地同屏。
 *
 * 用法：node scripts/pack-local.mjs
 * 产物：release/gator-hall-local-<版本>/（内含 启动.command / 启动.bat）
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const outDir = path.join(root, 'release');
const pkgDir = path.join(outDir, `gator-hall-local-${version}`);

// 1. 构建前端
console.log('🔨 构建前端……');
execSync('pnpm build', { cwd: root, stdio: 'inherit' });

// 2. 组装本地包
fs.rmSync(pkgDir, { recursive: true, force: true });
fs.mkdirSync(pkgDir, { recursive: true });
fs.cpSync(path.join(root, 'apps/web/dist'), pkgDir, { recursive: true });

// 3. 迷你静态服务器（仅监听 127.0.0.1；闲置超时自动退出；Ctrl+C/关窗口立即停）
fs.writeFileSync(
  path.join(pkgDir, 'server.py'),
  `import http.server
import socketserver
import threading
import time
import os

# 无论从哪里启动，都固定以本文件所在目录作为网站根目录，
# 避免“从桌面/其它目录手动运行时把那个目录当首页”的问题。
ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

PORT = 8123
# 闲置多少秒后自动退出（可用环境变量覆盖，方便测试）
IDLE_LIMIT = int(os.environ.get("TM_IDLE", "600"))

last_request = time.time()

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        global last_request
        last_request = time.time()
        return super().do_GET()

    def log_message(self, *args):
        pass  # 安静模式

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

with Server(("127.0.0.1", PORT), Handler) as httpd:
    def watcher():
        while True:
            time.sleep(10)
            if time.time() - last_request > IDLE_LIMIT:
                httpd.shutdown()
                return

    threading.Thread(target=watcher, daemon=True).start()
    print(f"[Gator Hall] local server: http://127.0.0.1:{PORT}")
    print(f"[Gator Hall] auto-stops after {IDLE_LIMIT}s idle, or Ctrl+C / close this window.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
print("[Gator Hall] server stopped.")
`,
);

// 4. 启动脚本（macOS 双击 / Windows 双击）
fs.writeFileSync(
  path.join(pkgDir, '启动.command'),
  `#!/bin/bash
# 小鳄龙之家 · 单机版启动器
# 双击运行；首次如被拦截请右键→打开（或在终端执行 chmod +x 启动.command）
cd "$(dirname "$0")"
open "http://127.0.0.1:8123"
exec python3 server.py
# 玩完关掉这个终端窗口（或 Ctrl+C）即停止服务；闲置 10 分钟也会自动退出
`,
);
fs.writeFileSync(
  path.join(pkgDir, '启动.bat'),
  // 说明：该启动器刻意只用 ASCII 文本，不依赖 chcp/UTF-8 控制台，避免部分
  // Windows 代码页/字体组合下中文 echo 报 "The system cannot write to the
  // specified device" 或 if(...) 复合块被误执行的问题；中文说明见 使用说明.txt。
  // 也不使用 where 探测（某些环境会报语法错误），改为直接尝试运行解释器。
  `@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\n\r\nrem --- Find a working Python 3 (only used to serve files locally) ---\r\nset "PY_CMD="\r\npython -c "import sys" >nul 2>&1\r\nif not errorlevel 1 set "PY_CMD=python"\r\nif defined PY_CMD goto :run\r\n\r\npy -3 -c "import sys" >nul 2>&1\r\nif not errorlevel 1 set "PY_CMD=py -3"\r\nif defined PY_CMD goto :run\r\n\r\necho [Gator Hall] Python 3 was not found (needed only to host files locally).\r\necho   1. Recommended: winget install Python.Python.3.12\r\necho   2. Or download https://www.python.org/downloads/ and check "Add Python to PATH"\r\necho   Install it, then double-click this file again.\r\npause\r\nexit /b 1\r\n\r\n:run\r\nrem Open the browser about 2 seconds later, so the server is already listening.\r\nstart "" /b cmd /c "ping -n 3 127.0.0.1 >nul & explorer http://127.0.0.1:8123"\r\n%PY_CMD% server.py\r\necho [Gator Hall] Server stopped (idle auto-exit or window closed).\r\npause\r\n`,
);
fs.writeFileSync(
  path.join(pkgDir, '使用说明.txt'),
  `小鳄龙之家 · 单机版 v${version}（完整游戏大厅）

【包含内容】
- 🐊 游戏大厅（统一入口，无需安装任何开发环境）
- 🧙《出包魔法师》桌游：本地 vs AI、本地多人热座，完整规则引擎内置
- 🐊《鳄龙咆哮》3D 英雄射击：本地 vs AI、训练场，全部英雄/武器/地图/枪械模型内置
- 两款游戏的联机入口（需在联机大厅填入已部署的游戏服务器地址）

【怎么玩】
- macOS：双击「启动.command」（如被拦截：右键→打开；或首次在终端执行 chmod +x 启动.command）
- Windows：双击「启动.bat」，等 1~2 秒浏览器自动打开 http://127.0.0.1:8123
  （启动器提示为英文以保证各 Windows 代码页兼容；中文说明即本文件）
- 手动启动的话，也请先进入本目录再执行 python server.py（脚本已内置目录切换，
  从别处执行也不会把桌面等其它文件夹当首页；但请勿用 python -m http.server 代替）

【服务会自动关闭，不留后台进程】
- 玩完关掉启动时弹出的那个小窗口（或按 Ctrl+C），服务立即停止
- 即使忘记关：闲置 10 分钟无操作也会自动退出
- 服务只监听本机（127.0.0.1），不对外暴露

【运行依赖】
- 现代浏览器（Chrome/Edge/Safari/Firefox 均可）
- Python3（仅用于托管本目录静态文件，不含任何游戏逻辑）：
  macOS 系统自带；Windows 需安装（启动.bat 会检测并给出安装指引）
- 不需要 Node.js / pnpm / npm；单人模式完全离线可玩

【为什么包约 20MB】
大厅与两款游戏的代码/规则引擎/AI 已全部打包进静态文件；体积主要来自
《鳄龙咆哮》的 3D 英雄、枪械与掩体模型（GLB），运行时无外部资源请求。

【联机】
单人 vs AI 完全本地。想联机：游戏内「联机大厅 → 服务器地址」填入
已部署的公网服务器地址（http://<IP或域名>:<端口>）即可；同地址的其它
玩家进入同一房间即可对战。
`,
);
fs.chmodSync(path.join(pkgDir, '启动.command'), 0o755);

execSync(`tar -czf "${pkgDir}.tar.gz" -C "${outDir}" "gator-hall-local-${version}"`);
console.log(`✅ 单机版包已生成：${pkgDir}.tar.gz（${(fs.statSync(`${pkgDir}.tar.gz`).size / 1024 / 1024).toFixed(2)} MB）`);
console.log('   解压后双击 启动.command / 启动.bat 即可游玩，无需安装任何开发环境');
