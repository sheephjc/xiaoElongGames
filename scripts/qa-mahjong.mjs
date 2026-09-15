/** Functional browser smoke only; deliberately produces no screenshots. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:5173';
const browser = await chromium.launch();
const contexts = [];
const errors = [];
const externalDatabaseRequests = [];
async function context(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 768 }); contexts.push(ctx);
  ctx.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/firebase|firestore|googleapis/.test(request.url())) externalDatabaseRequests.push(request.url()); });
  });
  return ctx;
}
try {
  const ctx = await context();
  const page = await ctx.newPage();
  await page.goto(BASE);
  assert.equal(await page.title(), '小鳄龙之家');
  await page.locator('[data-home-entry="hall"]').click();
  await page.locator('[data-game-id="zhangzhou-mahjong"]').click();
  await page.getByRole('button', { name: '开始单机', exact: true }).click();
  let frame = page.frameLocator('.mahjong-host-frame');
  await frame.locator('#hand-bottom .tile').first().waitFor();
  assert((await frame.locator('#hand-bottom .tile').count()) >= 16);
  await page.getByRole('button', { name: '返回游戏菜单', exact: true }).click();
  await page.getByRole('button', { name: '进入联机大厅', exact: true }).click();
  frame = page.frameLocator('.mahjong-host-frame');
  await frame.locator('#nickname-input').fill('测试房主');
  await frame.locator('#create-room-btn').click();
  await frame.locator('#battle-room-panel:not(.hidden)').waitFor();
  const text = await frame.locator('#battle-room-meta').innerText();
  const code = text.match(/\d{6}/)?.[0];
  assert(code, text);
  const friendContext = await context({ width: 390, height: 844 });
  const friend = await friendContext.newPage();
  await friend.goto(`${BASE}/mahjong/index.html?nickname=朋友`);
  await friend.locator('#room-code-input').fill(code);
  await friend.locator('#join-room-btn').click();
  await friend.locator('#battle-room-panel:not(.hidden)').waitFor();
  await frame.locator('#battle-start-btn').click();
  await frame.locator('#center-open-gold-btn').waitFor({ state: 'visible' });
  await frame.locator('#center-open-gold-btn').click({ force: true });
  await friend.waitForURL(/game\.html/);
  await friend.locator('#hand-bottom .tile').first().waitFor();
  await friend.reload();
  await friend.locator('#hand-bottom .tile').first().waitFor();
  assert((await friend.locator('#hand-bottom .tile').count()) >= 16);
  assert.equal(await frame.locator('#hand-top .tile:not(.back)').count(), 0);
  await frame.locator('#leave-room-btn:visible, #center-leave-room-btn:visible, #mobile-leave-room-btn:visible').first().click();
  await frame.locator('#lobby-form-card:not(.hidden)').waitFor();
  await friend.locator('#leave-room-btn:visible, #center-leave-room-btn:visible, #mobile-leave-room-btn:visible').first().click();
  await friend.waitForURL(/index\.html/);
  await page.getByRole('button', { name: '返回游戏菜单', exact: true }).click();
  await page.getByRole('button', { name: '返回游戏大厅', exact: true }).click();
  await page.locator('.home[data-panel="hall"]').waitFor();
  assert.deepEqual(externalDatabaseRequests, []);
  assert.deepEqual(errors, []);
  console.log('Mahjong browser: hall entry, local play, same-origin create/join/start/open-gold, mobile refresh, leave and return passed; no Firebase requests or screenshots');
} finally {
  for (const ctx of contexts) for (const page of ctx.pages()) for (const frame of page.frames()) {
    if (!frame.url().includes('/mahjong/')) continue;
    await frame.evaluate(async () => {
      try {
        const room = JSON.parse(sessionStorage.getItem('tm-mahjong-room') || 'null');
        if (room?.roomCode) {
          const { request } = await import('/mahjong/src/server-client.js');
          await request('room:leave', { roomCode: room.roomCode });
        }
      } catch { /* best-effort test-room cleanup */ }
    }).catch(() => {});
  }
  await Promise.all(contexts.map(ctx => ctx.close()));
  await browser.close();
}
