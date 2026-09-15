/**
 * 《鳄龙战场》布局 QA：多分辨率下检查横向溢出与关键元素可见性，并截图留档。
 * 用法：先启动前端(5173)，`node scripts/qa-layout-corcodragon.mjs`
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.TM_WEB ?? 'http://127.0.0.1:5173';
const OUT = fileURLToPath(new URL('../docs-dev/screenshots/corcodragon-fire/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { w: 1440, h: 900, name: 'desktop' },
  { w: 1024, h: 768, name: 'tablet' },
  { w: 390, h: 844, name: 'mobile' },
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
    await page.goto(BASE);
    await page.waitForSelector('.home[data-panel="main"]');
    await page.click('[data-home-entry="hall"]');
    await page.waitForSelector('.home[data-panel="hall"]');

    let overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 1) fail(`大厅 ${vp.name}(${vp.w}px) 横向溢出 ${overflow}px`);

    await page.locator('.home-game').filter({ hasText: '鳄龙战场' }).click();
    await page.waitForSelector('.cdf-detail-panel');
    overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 1) fail(`详情 ${vp.name}(${vp.w}px) 横向溢出 ${overflow}px`);

    await page.click('button:has-text("开始（本地 vs AI）")');
    await page.waitForSelector('.cdf-hero-panel');
    overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 1) fail(`英雄选择 ${vp.name}(${vp.w}px) 横向溢出 ${overflow}px`);

    await page.locator('.cdf-hero-card:not(.taken)').first().click();
    await page.waitForSelector('.cdf-arena');
    await page.waitForTimeout(600);
    overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 1) fail(`对局 ${vp.name}(${vp.w}px) 横向溢出 ${overflow}px`);

    await page.screenshot({ path: `${OUT}2026-08-15-qa-${vp.name}.png` });
    console.log(`✅ ${vp.name}（${vp.w}×${vp.h}）无横向溢出，截图已保存`);
    await ctx.close();
  }
} finally {
  await browser.close();
}

if (failed) process.exit(1);
console.log('✅ 鳄龙战场布局 QA 全部通过');
process.exit(0);
