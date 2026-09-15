/**
 * 《鳄龙战场》截图脚本：捕获大厅/详情/英雄选择/对局界面，存至 docs-dev/screenshots/corcodragon-fire/。
 * 用法：先启动服务端(8787，可选)与前端(5173)，再 `node scripts/shots-corcodragon.mjs`
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.TM_WEB ?? 'http://127.0.0.1:5173';
const OUT = fileURLToPath(new URL('../docs-dev/screenshots/corcodragon-fire/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png` });

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector('.home[data-panel="main"]');
  await sleep(300);

  // 大厅：确认鳄龙战场卡片出现
  await page.click('[data-home-entry="hall"]');
  await page.waitForSelector('.home[data-panel="hall"]');
  await sleep(400);
  await shot(page, '2026-08-15-hall');
  console.log('✅ hall');

  // 详情页
  const card = page.locator('.home-game').filter({ hasText: '鳄龙战场' });
  await card.click();
  await page.waitForSelector('.cdf-detail-panel');
  await sleep(400);
  await shot(page, '2026-08-15-detail');
  console.log('✅ detail');

  // 开始本地对局 → 英雄选择
  await page.click('button:has-text("开始（本地 vs AI）")');
  await page.waitForSelector('.cdf-hero-panel');
  await sleep(400);
  await shot(page, '2026-08-15-hero-select');
  console.log('✅ hero-select');

  // 选择炎刃进入对局
  await page.locator('.cdf-hero-card:not(.taken)').first().click();
  await page.waitForSelector('.cdf-arena');
  await sleep(900);
  await shot(page, '2026-08-15-battle');
  console.log('✅ battle');

  await page.close();
} finally {
  await browser.close();
}
