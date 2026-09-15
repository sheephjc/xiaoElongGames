/**
 * 手感调试面板冒烟：?debug=1 进入本地对局，确认 tweakpane 面板渲染且可交互，
 * 截图留档 docs-dev/screenshots/corcodragon-fight/。
 * 用法：先启动前端(5173)，`node scripts/smoke-tuning.mjs`
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.TM_WEB ?? 'http://127.0.0.1:5173';
const OUT = fileURLToPath(new URL('../docs-dev/screenshots/corcodragon-fight/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`${BASE}/?debug=1`);
  await page.waitForSelector('.home[data-panel="main"]');
  await page.click('[data-home-entry="hall"]');
  await page.waitForSelector('.home[data-panel="hall"]');
  await page.locator('.home-game').filter({ hasText: '鳄龙咆哮' }).click();
  await page.waitForSelector('.ccf-detail-panel');
  await page.click('button:has-text("开始（本地 vs AI）")');
  await page.waitForSelector('.ccf-hero-grid');
  await page.locator('.ccf-hero-card').first().click();
  await page.waitForSelector('.ccf-crosshair', { state: 'attached', timeout: 15_000 });
  // 等 tweakpane 异步加载完成（v4 根容器为 .tp-rotv）
  await page.waitForSelector('.ccf-tuning-host .tp-rotv', { timeout: 10_000 });
  await sleep(600);
  await page.screenshot({ path: `${OUT}2026-08-15-tuning-panel.png` });
  const labelCount = await page.locator('.ccf-tuning-host .tp-lblv').count();
  if (labelCount < 10) throw new Error(`调试面板控件数量异常：${labelCount}`);
  if (errors.length) throw new Error(`页面错误：${errors.join(' | ')}`);
  console.log(`✅ 调试面板已渲染（${labelCount} 个控件），无页面错误`);
} finally {
  await browser.close();
}
