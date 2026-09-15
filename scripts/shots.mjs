/**
 * Playwright 截图脚本：捕获各界面截图用于视觉评估，并做同机双窗口联机回归测试。
 * 用法：先启动服务端(8787)与前端(5173)，再 `node scripts/shots.mjs`
 * 输出：tools/vision-results/shots/*.png（已 gitignore）
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.TM_WEB ?? 'http://127.0.0.1:5173';
const OUT = fileURLToPath(new URL('../tools/vision-results/shots/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png` });

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // ---- 设置页 ----
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector('.home[data-panel="main"]');
  await sleep(400);
  await shot(page, '01-setup');
  console.log('✅ 01-setup');

  // ---- 本地对局（经大厅 → 出包魔法师 → 单人） ----
  await page.click('[data-home-entry="hall"]'); // 进入游戏大厅
  await page.waitForSelector('.home[data-panel="hall"]');
  await page.click('.home-game[data-game-id="trouble-magician"]');
  await page.waitForSelector('.detail-panel');
  await page.click('button:has-text("开始（本地 vs AI）")');
  await page.waitForSelector('.game-page');
  await sleep(900);
  await shot(page, '02-game');
  console.log('✅ 02-game');

  // 施法特效：先点巨龙（仅 1 张，大概率失败 → 失败特效），失败后重试直到拍到
  let failShot = false;
  for (let attempt = 0; attempt < 12 && !failShot; attempt++) {
    const dragon = page.locator('.magic-btn:not(:disabled)').filter({ hasText: '巨龙' });
    for (let i = 0; i < 30 && (await dragon.count()) === 0; i++) await sleep(800);
    if ((await dragon.count()) === 0) break;
    await dragon.click();
    await sleep(380);
    if (await page.locator('.full-fx.fail').count()) {
      await shot(page, '04-fx-fail');
      console.log('✅ 04-fx-fail');
      failShot = true;
    }
    await sleep(1500);
  }
  // 等轮到自己且药水可选时点击（成功特效）
  const potion = page.locator('.magic-btn:not(:disabled)').filter({ hasText: '药水' });
  for (let i = 0; i < 40 && (await potion.count()) === 0; i++) await sleep(800);
  if ((await potion.count()) > 0) {
    await potion.click();
    await sleep(300);
    await shot(page, '03-fx-cast');
    console.log('✅ 03-fx-cast');
  }
  await page.close();

  // ---- 游戏大厅 + 联机大厅 ----
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await ctx2.newPage();
  await page2.goto(BASE);
  await page2.waitForSelector('.home[data-panel="main"]');
  await page2.click('[data-home-entry="hall"]');
  await page2.waitForSelector('.home[data-panel="hall"]');
  await sleep(400);
  await shot(page2, '05-hall');
  console.log('✅ 05-hall');
  await page2.click('.home-game[data-game-id="trouble-magician"]');
  await page2.waitForSelector('.detail-panel');
  await page2.click('button:has-text("🌐 进入联机大厅")');
  await page2.waitForSelector('.lobby-panel');
  await sleep(400);
  await shot(page2, '05-lobby');
  console.log('✅ 05-lobby');
  await page2.close();
} finally {
  await browser.close();
}
