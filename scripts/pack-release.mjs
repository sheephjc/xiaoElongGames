/**
 * 发布打包脚本：生成可部署到服务器的 tar.gz 包。
 *
 * 客户端形态说明：本项目没有独立客户端包——前端构建产物（apps/web/dist）
 * 是纯静态文件（HTML/JS/CSS），由服务端同端口托管，浏览器访问即客户端。
 *
 * 用法（在仓库根目录）：
 *   node scripts/pack-release.mjs
 *
 * 产物：
 *   release/trouble-magician-<版本号>.tar.gz
 *
 * 服务器部署：
 *   tar xzf trouble-magician-<版本>.tar.gz && cd trouble-magician-<版本>
 *   pnpm install --frozen-lockfile --prod     # 仅装服务端运行时依赖（tsx 已在 dependencies）
 *   PORT=8080 HOST=0.0.0.0 pnpm --filter @tm/server start
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const outDir = path.join(root, 'release');
const pkgDir = path.join(outDir, `trouble-magician-${version}`);
const tarball = path.join(outDir, `trouble-magician-${version}.tar.gz`);

// 1. 构建前端（确保 dist 最新）
console.log('🔨 构建前端……');
execSync('pnpm build', { cwd: root, stdio: 'inherit' });

// 2. 收集发布文件
fs.rmSync(pkgDir, { recursive: true, force: true });
fs.mkdirSync(pkgDir, { recursive: true });

/** 复制单个文件或目录（目录默认排除 node_modules 与 assets；dist 必须保留 assets） */
function copyItem(from, to, opts = {}) {
  const src = path.join(root, from);
  const dest = path.join(pkgDir, to);
  if (!fs.existsSync(src)) {
    console.warn(`⚠️ 跳过（不存在）：${from}`);
    return;
  }
  const stat = fs.statSync(src);
  if (stat.isFile()) {
    fs.cpSync(src, dest);
    return;
  }
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (p) => {
      const parts = p.split(path.sep);
      if (parts.includes('node_modules')) return false;
      if (opts.excludeAssets !== false && parts.includes('assets')) return false;
      return !p.endsWith('.DS_Store');
    },
  });
}

// pnpm-lock.yaml 的 importer 覆盖根 + apps/server + apps/web + 全部 games/* + packages/rules，
// 发布包必须包含这些 workspace 包目录（至少 package.json），否则服务器上
// `pnpm install --frozen-lockfile` 会因锁文件与工作区不一致而失败。
// games 源文件只保留运行/审查所需源码，排除 node_modules 与 assets（3D 素材已打进 web dist）。
const include = [
  ['package.json', 'package.json'],
  ['pnpm-workspace.yaml', 'pnpm-workspace.yaml'],
  ['pnpm-lock.yaml', 'pnpm-lock.yaml'],
  ['tsconfig.base.json', 'tsconfig.base.json'],
  ['packages/rules', 'packages/rules'],
  ['apps/server', 'apps/server'],
  ['apps/web/package.json', 'apps/web/package.json'],
  ['apps/web/tsconfig.json', 'apps/web/tsconfig.json'],
  ['apps/web/dist', 'apps/web/dist', { excludeAssets: false }],
  ['games', 'games'],
  ['README.md', 'README.md'],
  ['docs', 'docs'],
  ['deploy/1panel/compose.yaml', 'compose.yaml'],
  ['deploy/1panel/install-deps.sh', 'install-deps.sh'],
  ['scripts/check-deployment.mjs', 'scripts/check-deployment.mjs'],
];

for (const [from, to, opts] of include) copyItem(from, to, opts);

// 3. 打包
fs.rmSync(tarball, { force: true });
execSync(`tar -czf "${tarball}" -C "${outDir}" "trouble-magician-${version}"`);
console.log(`✅ 发布包已生成：${tarball}`);
console.log(`   大小：${(fs.statSync(tarball).size / 1024 / 1024).toFixed(2)} MB`);
console.log('   服务器部署步骤见 docs/DEPLOY.md「发布包部署」章节');
