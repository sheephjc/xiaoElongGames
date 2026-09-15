/**
 * 4/5 人局截图（用于布局拥挤问题的识图分析）。
 * 用法：先启动服务端(8787)与前端(5173)，再 `node scripts/shots-5p.mjs`
 * 输出：tools/vision-results/shots/06-game-4p.png、07-game-5p.png
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.TM_WEB ?? 'http://127.0.0.1:5173';
const OUT = fileURLToPath(new URL('../tools/vision-results/shots/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
try {
  for (const n of [4, 5]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForSelector('.home[data-panel="main"]');
    await page.click('[data-home-entry="hall"]'); // 进入游戏大厅
    await page.waitForSelector('.home[data-panel="hall"]');
    await page.click('.home-game[data-game-id="trouble-magician"]');
    await page.waitForSelector('.detail-panel');
    // 选 n 人
    await page.click(`.count-btn:has-text("${n} 人")`);
    await page.click('button:has-text("开始（本地 vs AI）")');
    await page.waitForSelector('.game-page');
    await sleep(1200);
    const name = n === 4 ? '06-game-4p' : '07-game-5p';
    await page.screenshot({ path: `${OUT}${name}.png` });
    console.log(`✅ ${name}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
