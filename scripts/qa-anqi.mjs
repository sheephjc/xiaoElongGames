/** 暗棋接入回归：同源入口、本地落子、双人同步、刷新后恢复及样式隔离。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';
const OUT = fileURLToPath(new URL('../output/playwright/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const contexts = [];
async function openGame(page) {
  await page.goto(BASE);
  await page.locator('[data-home-entry="hall"]').click();
  await page.waitForSelector('.home[data-panel="hall"] .home-panel[aria-busy="false"]');
  await page.locator('[data-game-id="anqi"]').click();
  await page.waitForSelector('.anqi-game .mode-grid');
  assert.equal(new URL(page.url()).origin, new URL(BASE).origin);
  assert.equal(await page.title(), '小鳄龙之家');
}
async function makePage(width = 1440, height = 900) {
  const context = await browser.newContext({ viewport: { width, height } });
  contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await openGame(page);
  return page;
}
async function hiddenCount(page, count) {
  await page.waitForFunction(
    (n) => document.querySelectorAll('.anqi-game .piece.is-hidden').length === n,
    count,
  );
}
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const page = await makePage(width, height);
    await page.screenshot({ path: `${OUT}anqi-modes-${width}x${height}.png`, fullPage: true });
    await page.getByRole('link', { name: /本地对战/ }).click();
    await hiddenCount(page, 30);
    await page.getByRole('button', { name: '暗棋，1路第10行', exact: true }).click();
    await page.locator('[data-cell="0,8"]').click();
    await hiddenCount(page, 29);
    await page.getByRole('button', { name: '玩法', exact: true }).click();
    await page.waitForSelector('[role="dialog"][aria-labelledby="rules-title"]');
    await page.getByRole('button', { name: '明白了', exact: true }).click();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.anqi-game img')].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    );
    await page.screenshot({ path: `${OUT}anqi-local-${width}x${height}.png`, fullPage: true });
    await page.getByRole('link', { name: '首页', exact: true }).click();
    await page.getByRole('button', { name: '返回游戏大厅', exact: true }).click();
    await page.waitForSelector('.home[data-panel="hall"]');
    assert.equal(
      await page
        .locator('.home')
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--home-ink').trim()),
      '#213f32',
    );
    assert.equal(await page.locator('.home-game').count(), 3);
    console.log(`✓ ${width}×${height} 暗棋入口／本地落子／规则／素材／返回与样式隔离`);
  }

  const host = await makePage();
  const guest = await makePage();
  await host.getByRole('link', { name: /联机对战/ }).click();
  assert.equal(await host.getByRole('textbox', { name: '你的昵称' }).inputValue(), '你');
  await host.getByRole('textbox', { name: '你的昵称' }).fill('暗棋房主');
  await host.getByRole('button', { name: '创建房间', exact: true }).click();
  await host.waitForSelector('.room-code-display strong');
  const code = (await host.locator('.room-code-display strong').innerText()).trim();
  assert.match(code, /^[1-9]\d{3}$/);
  await guest.getByRole('link', { name: /联机对战/ }).click();
  await guest.getByRole('textbox', { name: '你的昵称' }).fill('暗棋棋友');
  await guest.getByRole('textbox', { name: '四位房间号' }).fill(code);
  await guest.getByRole('button', { name: '加入房间', exact: true }).click();
  await Promise.all([hiddenCount(host, 30), hiddenCount(guest, 30)]);
  await host.waitForFunction(() =>
    /轮到你行棋|等待对方行棋/.test(
      document.querySelector('.anqi-game .match-card h2')?.textContent ?? '',
    ),
  );
  const ownCamp = await host.locator('.match-card small').innerText();
  const red = ownCamp.includes('红') ? host : guest;
  await red.getByRole('button', { name: '暗棋，1路第10行', exact: true }).click();
  await red.locator('[data-cell="0,8"]').click();
  await Promise.all([hiddenCount(host, 29), hiddenCount(guest, 29)]);
  await host.screenshot({ path: `${OUT}anqi-online.png`, fullPage: true });

  // 网站刷新后回到首页；重新打开暗棋可通过已保存房间恢复棋局。
  await openGame(guest);
  await guest.getByRole('link', { name: `继续房间 ${code}`, exact: true }).click();
  await hiddenCount(guest, 29);
  await guest.waitForFunction(() =>
    /轮到你行棋|等待对方行棋/.test(
      document.querySelector('.anqi-game .match-card h2')?.textContent ?? '',
    ),
  );
  assert.equal(await guest.locator('.piece.is-revealed').count(), 3);
  assert.deepEqual(errors, [], '浏览器运行错误');
  console.log('✓ 同源双人建房／加入／隐藏身份同步／刷新后重连');
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
