/**
 * 《鳄龙咆哮》技能/枪模 QA 截图：逐英雄进入本地对局，触发技能并截图。
 * 用法：先启动前端(5173)，`node scripts/qa-skills-corcodragon.mjs [heroKey]`
 * 输出：docs-dev/screenshots/corcodragon-fight/skills-rework/（截图只新增，不删除）
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.TM_WEB ?? 'http://127.0.0.1:5173';
const OUT = fileURLToPath(
  new URL('../docs-dev/screenshots/corcodragon-fight/skills-rework/', import.meta.url),
);
fs.mkdirSync(OUT, { recursive: true });

const HEROES = {
  tiebi: { name: '铁壁', keys: ['q'], shots: ['shield'] },
  guilei: {
    name: '诡雷',
    keys: ['q'],
    afterKey: async (page) => {
      // 左键确认投掷：截取抛物线飞行中的炸弹
      await page.mouse.move(720, 450);
      await page.mouse.down({ button: 'left' });
      await page.mouse.up({ button: 'left' });
      await sleep(200);
    },
    shots: ['bomb-aim', 'bomb-flight'],
  },
  yingxiao: { name: '影枭', keys: ['q'], shots: ['stealth'] },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const date = new Date().toISOString().slice(0, 10);
const shot = (page, name) => page.screenshot({ path: `${OUT}${date}-${name}.png` });

const heroArg = process.argv[2] ?? Object.keys(HEROES).join(',');
const targets = Object.entries(HEROES).filter(([k]) => heroArg === 'all' || heroArg.split(',').includes(k));

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  for (const [key, spec] of targets) {
    const page = await ctx.newPage();
    page.on('pageerror', (err) => console.log(`⚠️ [${key}] pageerror:`, err.message));
    await page.goto(BASE);
    await page.waitForSelector('.home[data-panel="main"]');
    await page.click('[data-home-entry="hall"]');
    await page.waitForSelector('.home[data-panel="hall"]');
    await page.locator('.home-game').filter({ hasText: '鳄龙咆哮' }).click();
    await page.waitForSelector('.ccf-detail-panel');
    await page.click('button:has-text("开始（本地 vs AI）")');
    await page.waitForSelector('.ccf-hero-grid');
    await sleep(300);
    await page.locator('.ccf-hero-card').filter({ hasText: spec.name }).first().click();
    await page.waitForSelector('.ccf-canvas-host canvas');
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      if (await page.locator('.ccf-crosshair').count()) break;
    }
    await sleep(1500);
    await shot(page, `${key}-idle`);
    for (const k of spec.keys) {
      await page.keyboard.press(k === 'q' ? 'KeyQ' : 'KeyE');
      await sleep(700);
      await shot(page, `${key}-${spec.shots[0] ?? 'skill'}`);
      if (spec.afterKey) await spec.afterKey(page);
      for (const name of spec.shots.slice(1)) await shot(page, `${key}-${name}`);
    }
    await page.close();
    console.log(`✅ ${key}（${spec.name}）`);
  }
} finally {
  await browser.close();
}
