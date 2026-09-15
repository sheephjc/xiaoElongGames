/**
 * 《鳄龙咆哮》双窗口联机回归：A 建房 → B 加入 → 开始 → 双方选英雄 → 进入对局。
 * 用法：先启动服务端(8787)与前端(5173)，`node scripts/e2e-twowindow-corcodragon.mjs`
 * 输出：docs-dev/screenshots/corcodragon-fight/ 截图留档。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.TM_WEB ?? 'http://127.0.0.1:5173';
const OUT = fileURLToPath(new URL('../docs-dev/screenshots/corcodragon-fight/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function toFightDetail(page) {
  await page.goto(BASE);
  await page.waitForSelector('.home[data-panel="main"]');
  await page.click('[data-home-entry="hall"]');
  await page.waitForSelector('.home[data-panel="hall"]');
  await page.locator('.home-game').filter({ hasText: '鳄龙咆哮' }).click();
  await page.waitForSelector('.ccf-detail-panel');
}

const browser = await chromium.launch();
try {
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  for (const [name, page] of [['A', a], ['B', b]]) {
    page.on('pageerror', (err) => console.log(`⚠️ ${name} pageerror:`, err.message));
  }

  // A 建房
  await toFightDetail(a);
  await a.click('button:has-text("🌐 进入联机大厅")');
  await a.waitForSelector('.lobby-panel');
  await a.click('button:has-text("➕ 创建房间")');
  await a.waitForSelector('.room-code');
  await sleep(300);
  const code = (await a.locator('.rc-code').innerText()).trim();
  console.log(`✅ A 建房成功：${code}`);
  await a.screenshot({ path: `${OUT}2026-08-15-online-lobby.png` });

  // B 加入
  await toFightDetail(b);
  await b.click('button:has-text("🌐 进入联机大厅")');
  await b.waitForSelector('.lobby-panel');
  await b.locator('.join-block input.code-input').first().fill(code);
  await b.locator('.join-block button.primary-btn').first().click();
  await b.waitForSelector('.room-code');
  console.log('✅ B 已加入房间');

  // A 等待两人后开始
  await sleep(400);
  await a.click('button:has-text("🎮 开始对战")');
  await a.waitForSelector('.ccf-hero-grid', { timeout: 10_000 });
  await b.waitForSelector('.ccf-hero-grid', { timeout: 10_000 });
  console.log('✅ 双方进入英雄选择');
  await a.locator('.ccf-hero-card').nth(0).click();
  await b.locator('.ccf-hero-card').nth(1).click();
  await sleep(600);
  await a.screenshot({ path: `${OUT}2026-08-15-online-hero-A.png` });

  // 等进入对局（HUD 出现准星）
  await a.waitForSelector('.ccf-crosshair', { state: 'attached', timeout: 15_000 });
  await b.waitForSelector('.ccf-crosshair', { state: 'attached', timeout: 15_000 });
  await sleep(2500);
  await a.screenshot({ path: `${OUT}2026-08-15-online-A.png` });
  await b.screenshot({ path: `${OUT}2026-08-15-online-B.png` });
  console.log('✅ 双方进入 3D 对局并收到实时快照');

  // 验证计分板与 HUD 文本
  const hudA = await a.locator('.ccf-hud-bottom-left').innerText();
  if (!hudA.includes('/')) throw new Error('A HUD 弹药信息缺失');
  await a.keyboard.press('Tab');
  await sleep(300);
  await a.screenshot({ path: `${OUT}2026-08-15-online-scoreboard.png` });
  await a.keyboard.press('Tab');

  // 退出：A 离开后房间应清空关闭（B 观察 lobby 回来）
  await a.locator('.ccf-hint').count().then(async (n) => {
    if (n === 0 && !(await a.locator('.ccf-overlay').count())) {
      // 已锁定鼠标时点退出前先按 Esc
      await a.keyboard.press('Escape');
    }
  });
  await a.click('button:has-text("← 退出")');
  await a.waitForSelector('.ccf-detail-panel');
  console.log('✅ A 退出对局');

  await ctxA.close();
  await ctxB.close();
  console.log('🎉 双窗口联机回归完成');
} finally {
  await browser.close();
}
