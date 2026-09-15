/**
 * 布局 QA：多分辨率下检查横向溢出与关键元素可见性。
 * 用法：先启动服务端(8787)与前端(5173)，再 `node scripts/qa-layout.mjs`
 */
import { chromium } from 'playwright';

const BASE = process.env.TM_WEB ?? 'http://127.0.0.1:5173';
const VIEWPORTS = [
  { w: 1920, h: 1080, name: '大桌面' },
  { w: 1440, h: 900, name: '桌面' },
  { w: 1024, h: 768, name: '平板横屏' },
  { w: 768, h: 1024, name: '平板竖屏' },
  { w: 390, h: 844, name: '手机' },
  { w: 844, h: 390, name: '手机横屏' },
];

let failed = false;
const fail = (m) => {
  console.error(`❌ ${m}`);
  failed = true;
};

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();

    // 首页
    await page.goto(BASE);
    await page.waitForSelector('.home[data-panel="main"]');
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) fail(`首页 ${vp.name}(${vp.w}px) 横向溢出 ${overflow}px`);

    // 对局页（经大厅 → 出包魔法师 → 单人）
    await page.click('[data-home-entry="hall"]');
    await page.waitForSelector('.home[data-panel="hall"]');
    await page.click('.home-game[data-game-id="trouble-magician"]');
    await page.waitForSelector('.detail-panel');
    await page.click('button:has-text("开始（本地 vs AI）")');
    await page.waitForSelector('.game-page');
    await page.waitForTimeout(400);
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) fail(`对局页 ${vp.name}(${vp.w}px) 横向溢出 ${overflow}px`);
    const magicBtns = await page.locator('.magic-btn').count();
    if (magicBtns !== 8) fail(`对局页 ${vp.name} 魔法按钮应 8 个，实际 ${magicBtns}`);

    await ctx.close();
    console.log(`✅ ${vp.name}（${vp.w}×${vp.h}）：首页/对局页无横向溢出，8 个魔法按钮完整`);
  }
} finally {
  await browser.close();
}

if (failed) process.exit(1);
console.log('✅ 布局 QA 全部通过');
process.exit(0);
