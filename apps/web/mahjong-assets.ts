import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const source = fileURLToPath(new URL('../../games/zhangzhou-mahjong/client/', import.meta.url));
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/** Keep the original DOM game isolated while publishing it with the platform build. */
export function mahjongAssets(): Plugin {
  let outDir: string;
  let building = false;
  function copyDirectory(from: string, to: string) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, entry.name);
      const dest = path.join(to, entry.name);
      if (entry.isDirectory()) copyDirectory(src, dest);
      else if (entry.isFile()) fs.copyFileSync(src, dest);
    }
  }
  return {
    name: 'mahjong-assets',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); building = config.command === 'build'; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (!url.pathname.startsWith('/mahjong/')) return next();
        let relative: string;
        try { relative = decodeURIComponent(url.pathname.slice('/mahjong/'.length)) || 'index.html'; } catch { res.statusCode = 400; res.end(); return; }
        const target = path.resolve(source, relative);
        if (!target.startsWith(source) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.statusCode = 404; res.end('Not found'); return; }
        res.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
        fs.createReadStream(target).pipe(res);
      });
    },
    closeBundle() { if (building) copyDirectory(source, path.join(outDir, 'mahjong')); },
  };
}
