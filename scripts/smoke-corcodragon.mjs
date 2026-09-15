/**
 * 《鳄龙战场》本地对局 UI 冒烟：选英雄后自动结束回合，等待 AI 打完一局并截图结算。
 * 用法：先启动前端(5173)，`node scripts/smoke-corcodragon.mjs`
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.TM_WEB ?? 'http://127.0.0.1:5173';
const OUT = fileURLToPath(new URL('../docs-dev/screenshots/corcodragon-fire/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector('.home[data-panel="main"]');
  await page.click('[data-home-entry="hall"]');
  await page.waitForSelector('.home[data-panel="hall"]');
  await page.locator('.home-game').filter({ hasText: '鳄龙战场' }).click();
  await page.waitForSelector('.cdf-detail-panel');
  await page.click('button:has-text("开始（本地 vs AI）")');
  await page.waitForSelector('.cdf-hero-panel');
  await page.locator('.cdf-hero-card:not(.taken)').first().click();
  await page.waitForSelector('.cdf-arena');

  let ended = false;
  for (let i = 0; i < 150; i++) {
    await sleep(900);
    if (await page.locator('.cdf-overlay').count()) {
      ended = true;
      break;
    }
    const endBtn = page.locator('button:has-text("结束回合")');
    if ((await endBtn.count()) && (await endBtn.isEnabled())) {
      await endBtn.click();
    }
  }
  if (ended) {
    await page.screenshot({ path: `${OUT}2026-08-15-gameover.png` });
    console.log('✅ gameOver 截图已保存');
  } else {
    console.log('⚠️ 未在预期回合内结束，仍截图当前画面');
    await page.screenshot({ path: `${OUT}2026-08-15-smoke-timeout.png` });
  }
  await page.close();
} finally {
  await browser.close();
}
