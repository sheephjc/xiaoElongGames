/**
 * 《鳄龙咆哮》布局 QA：桌面/平板/手机三档，检查无横向溢出并截图留档。
 * 用法：先启动前端(5173)，`node scripts/qa-layout-corcodragon-fight.mjs`
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.TM_WEB ?? 'http://127.0.0.1:5173';
const OUT = fileURLToPath(new URL('../docs-dev/screenshots/corcodragon-fight/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];

const browser = await chromium.launch();
let failed = false;
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForSelector('.home[data-panel="main"]');
    await page.click('[data-home-entry="hall"]');
    await page.waitForSelector('.home[data-panel="hall"]');
    await page.locator('.home-game').filter({ hasText: '鳄龙咆哮' }).click();
    await page.waitForSelector('.ccf-detail-panel');
    await sleep(200);

    const checkOverflow = async (label) => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      if (overflow > 2) {
        console.log(`❌ ${vp.name}/${label} 横向溢出 ${overflow}px`);
        failed = true;
      } else {
        console.log(`✅ ${vp.name}/${label} 无横向溢出`);
      }
    };

    await checkOverflow('detail');
    await page.screenshot({ path: `${OUT}2026-08-15-qa-${vp.name}-detail.png` });

    await page.click('button:has-text("开始（本地 vs AI）")');
    await page.waitForSelector('.ccf-hero-grid');
    await checkOverflow('hero');
    await page.screenshot({ path: `${OUT}2026-08-15-qa-${vp.name}-hero.png` });

    await page.locator('.ccf-hero-card').first().click();
    await page.waitForSelector('.ccf-crosshair', { state: 'attached', timeout: 15_000 });
    await sleep(1200);
    await checkOverflow('battle');
    await page.screenshot({ path: `${OUT}2026-08-15-qa-${vp.name}-battle.png` });

    await ctx.close();
  }
  if (failed) process.exit(1);
  console.log('🎉 三档布局 QA 完成');
} finally {
  await browser.close();
}
