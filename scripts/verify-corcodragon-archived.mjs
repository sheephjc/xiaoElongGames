/**
 * 归档验证：确认《鳄龙战场》已从大厅隐藏，且出包魔法师仍正常显示。
 * 用法：先启动前端(5173)，`node scripts/verify-corcodragon-archived.mjs`
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.TM_WEB ?? 'http://127.0.0.1:5173';
const OUT = fileURLToPath(new URL('../docs-dev/screenshots/corcodragon-fire/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE);
  await page.waitForSelector('.home[data-panel="main"]');
  await page.click('[data-home-entry="hall"]');
  await page.waitForSelector('.home[data-panel="hall"]');
  await page.waitForTimeout(400);

  const cards = await page.locator('.home-game').allTextContents();
  const hasBattlefield = cards.some((t) => t.includes('鳄龙战场'));
  const hasTrouble = cards.some((t) => t.includes('出包魔法师'));
  await page.screenshot({ path: `${OUT}2026-08-15-archived-hall.png` });

  if (hasBattlefield) {
    console.error('❌ 归档验证失败：大厅仍显示《鳄龙战场》');
    process.exitCode = 1;
  } else if (!hasTrouble) {
    console.error('❌ 归档验证失败：出包魔法师未显示');
    process.exitCode = 1;
  } else {
    console.log('✅ 归档验证通过：《鳄龙战场》已隐藏，出包魔法师正常显示');
  }
  await page.close();
} finally {
  await browser.close();
}
