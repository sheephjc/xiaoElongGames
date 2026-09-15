/** 首页用户流程、六档布局及素材失败回归。截图保存到 output/playwright/。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? process.env.TM_WEB ?? 'http://127.0.0.1:5173';
const OUT = fileURLToPath(new URL('../output/playwright/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const viewports = [
  [1920, 1080],
  [1440, 900],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [844, 390],
];
const browser = await chromium.launch();
const errors = [];
const ready = (page, panel) =>
  page.waitForFunction(
    (p) => document.querySelector(`.home[data-panel="${p}"] .home-panel[aria-busy="false"]`),
    panel,
  );
const openHall = async (page) => {
  await page.locator('[data-home-entry="hall"]').click();
  await ready(page, 'hall');
};
const goHome = async (page) => {
  await page.locator('.home-back').click();
  await ready(page, 'main');
};
const expectBlurredHomeScene = async (page, expectedSrc) => {
  const scene = await page.locator('.home-scene').evaluate((element) => ({
    opacity: Number(getComputedStyle(element).opacity),
    filter: getComputedStyle(element.querySelector('.home-scene-image')).filter,
    src: element.querySelector('.home-scene-image').getAttribute('src'),
  }));
  assert.equal(scene.src, expectedSrc, '展开后继续使用首页场景图');
  assert.equal(scene.opacity, 1, '展开后的首页场景保持可见');
  assert.match(scene.filter, /blur\([1-9]/, '展开后的首页场景使用模糊效果');
};

async function checkLayout(page, width, height) {
  const issues = await page.evaluate(
    ({ width, height }) => {
      const issues = [];
      if (document.documentElement.scrollWidth > width + 1) issues.push('横向溢出');
      for (const el of document.querySelectorAll(
        '.home-entry, .home-game, .home-games, .home-tools, .home-back',
      )) {
        const box = el.getBoundingClientRect();
        if (box.left < -1 || box.right > width + 1) issues.push(`${el.className} 越过左右边界`);
        if (
          width >= 1024 &&
          !el.classList.contains('home-game') &&
          (box.top < 0 || box.bottom > height)
        )
          issues.push(`${el.className} 超出桌面视口`);
      }
      return issues;
    },
    { width, height },
  );
  assert.deepEqual(issues, [], `${width}×${height} 布局问题`);
}

try {
  for (const [width, height] of viewports) {
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 1024 });
    const page = await ctx.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(BASE);
    await ready(page, 'main');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.home img')].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    );
    await checkLayout(page, width, height);
    assert.equal(await page.locator('.home-entry').count(), 3);
    const scene = await page.locator('.home-scene-image').getAttribute('src');
    if (!process.env.TM_NO_SCREENSHOTS) await page.screenshot({
      path: `${OUT}home-${width}x${height}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await openHall(page);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.home img')].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    );
    assert.deepEqual(
      await page
        .locator('.home-game')
        .evaluateAll((cards) => cards.map((card) => card.dataset.gameId)),
      ['trouble-magician', 'corcodragon-fight', 'anqi', 'zhangzhou-mahjong'],
    );
    assert.equal(await page.locator('.home-scene-image').getAttribute('src'), scene);
    await checkLayout(page, width, height);
    assert.equal(
      await page.locator('#home-panel-title').evaluate((el) => el === document.activeElement),
      true,
    );
    if (!process.env.TM_NO_SCREENSHOTS) await page.screenshot({
      path: `${OUT}hall-${width}x${height}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    const scrollable = await page
      .locator('.home-games')
      .evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    if (scrollable) {
      await page.locator('.home-games').hover();
      await page.mouse.wheel(0, 400);
      await page.waitForFunction(() => document.querySelector('.home-games').scrollTop > 0);
      await page.locator('[data-game-id="zhangzhou-mahjong"]').scrollIntoViewIfNeeded();
      if (!process.env.TM_NO_SCREENSHOTS) await page.screenshot({
        path: `${OUT}hall-scrolled-${width}x${height}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
    await page.locator('.home-expand').click();
    await page.waitForSelector('.home[data-layout="all"] .home-panel[aria-busy="false"]');
    await expectBlurredHomeScene(page, scene);
    await checkLayout(page, width, height);
    assert.equal(await page.locator('.home-game').count(), 4);
    assert.equal(await page.locator('.home-expand').getAttribute('aria-expanded'), 'true');
    const gallery = await page.locator('.home-game').first().evaluate(el => {
      const cover = el.querySelector('.home-game-cover').getBoundingClientRect();
      const body = el.querySelector('.home-game-body').getBoundingClientRect();
      return body.top >= cover.bottom - 1;
    });
    assert.equal(gallery, true, '展开后封面位于信息上方');
    await page.locator('.home-expand').click();
    await page.waitForSelector('.home[data-layout="list"] .home-panel[aria-busy="false"]');
    await goHome(page);
    for (const [panel, text] of [
      ['projects', '项目内容正在整理'],
      ['members', '成员介绍'],
    ]) {
      if (width < 1024) await page.locator(`[data-home-entry="${panel}"]`).tap();
      else {
        await page.locator(`[data-home-entry="${panel}"]`).focus();
        await page.keyboard.press('Enter');
      }
      await ready(page, panel);
      if (panel === 'members') {
        assert.equal(await page.locator('.home').getAttribute('data-layout'), 'all');
        assert.equal(await page.locator('.member-profile').count(), 7);
        assert.equal(await page.locator('.home-tools').count(), 0, '成员页不显示昵称与偏好工具');
        assert.equal(await page.locator('.home-footer').count(), 0, '成员页不显示底部标语');
        assert.ok((await page.locator('.home-scene-image').getAttribute('src')).endsWith('members/background.jpg'), '成员页使用指定合照背景');
        const websiteLogo = page.locator('[data-member-id="hu"] [data-link="website"] .member-link-logo');
        assert.ok((await websiteLogo.getAttribute('src')).endsWith('members/woodstock.png'), 'HJC 的个人网站使用指定图标');
        await websiteLogo.evaluate(image => image.complete && image.naturalWidth > 0 || new Promise((resolve, reject) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', () => reject(new Error('网站图标加载失败')), { once: true });
        }));
        assert.equal(await page.locator('[data-member-id="a"] .member-name').evaluate(name =>
          getComputedStyle(name).textOverflow !== 'ellipsis' && name.scrollWidth <= name.clientWidth + 1), true, '长昵称完整展示，不使用省略号');
        assert.equal(await page.locator('.member-links .member-link').count(), 5);
        const memberEffects = await page.evaluate(() => {
          const home = document.querySelector('.home');
          const profile = document.querySelector('.member-profile');
          const frames = profile.getAnimations().flatMap(animation => animation.effect?.getKeyframes?.() ?? []);
          return {
            profileAnimation: getComputedStyle(profile).animationName,
            entersFromRight: frames.some(frame => String(frame.transform).includes('100vw')),
            starsAnimation: getComputedStyle(home, '::before').animationName,
            galaxyAnimation: getComputedStyle(home, '::after').animationName,
          };
        });
        assert.match(memberEffects.profileAnimation, /member-star-appear/, '成员使用星芒闪现入场');
        assert.equal(memberEffects.entersFromRight, false, '成员不再从屏幕右侧移入');
        assert.match(memberEffects.starsAnimation, /member-stars-drift/, '成员背景包含漂移星点');
        assert.match(memberEffects.galaxyAnimation, /member-galaxy-drift/, '成员背景包含星河光带');
        for (const [id, links] of [
          ['chui', ['github']],
          ['hu', ['website', 'github']],
          ['a', []],
          ['mx', ['github']],
          ['guo', ['github']],
          ['chili', []],
          ['daimeng-hf', []],
        ]) {
          assert.deepEqual(
            await page.locator(`[data-member-id="${id}"] .member-link`).evaluateAll(nodes =>
              nodes.map(node => node.dataset.link).sort()),
            [...links].sort(),
            `${id} 仅保留指定的个人链接图标`,
          );
        }
        const memberPresentation = await page.evaluate(() => {
          const home = document.querySelector('.home');
          const homeStyle = getComputedStyle(home);
          const homeBox = home.getBoundingClientRect();
          const heading = document.querySelector('.home-panel-heading');
          const headingBox = heading.getBoundingClientRect();
          const title = document.querySelector('#home-panel-title');
          const scene = document.querySelector('.home-scene');
          const image = document.querySelector('.home-scene-image');
          const region = document.querySelector('.home-members');
          const regionStyle = getComputedStyle(region);
          return {
            headingHidden: headingBox.width <= 1 && headingBox.height <= 1,
            titleFocusable: getComputedStyle(title).display !== 'none' && title === document.activeElement,
            sceneOpacity: Number(getComputedStyle(scene).opacity),
            imageFilter: getComputedStyle(image).filter,
            scrollbarWidth: regionStyle.scrollbarWidth,
            overflowY: regionStyle.overflowY,
            homePosition: homeStyle.position,
            homeZIndex: Number(homeStyle.zIndex),
            homeBox: { left: homeBox.left, top: homeBox.top, width: homeBox.width, height: homeBox.height },
            regionFits: region.scrollHeight <= region.clientHeight + 1,
            documentFits: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1 &&
              Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) <= innerHeight + 1,
          };
        });
        assert.equal(memberPresentation.headingHidden, true, '成员标题不占用可见布局');
        assert.equal(memberPresentation.titleFocusable, true, '隐藏标题仍接收栏目切换后的焦点');
        assert.equal(memberPresentation.sceneOpacity, 1, '成员页合照背景可见');
        assert.match(memberPresentation.imageFilter, /blur\([1-9]/, '成员合照具有静态模糊效果');
        assert.equal(memberPresentation.scrollbarWidth, 'none', '成员列表隐藏滚动条');
        assert.equal(memberPresentation.overflowY, 'hidden', '成员页不提供上下滚动');
        assert.equal(memberPresentation.homePosition, 'fixed', '成员页使用独立的固定全屏图层');
        assert.ok(memberPresentation.homeZIndex > 10, '成员页图层位于首页内容与反馈图层上方');
        assert.ok(Math.abs(memberPresentation.homeBox.left) <= 1 && Math.abs(memberPresentation.homeBox.top) <= 1 &&
          Math.abs(memberPresentation.homeBox.width - width) <= 1 && Math.abs(memberPresentation.homeBox.height - height) <= 1,
          '成员页图层准确覆盖当前视口');
        assert.equal(memberPresentation.regionFits, true, '七位成员在区域内完整展示，无隐藏滚动内容');
        assert.equal(memberPresentation.documentFits, true, '成员页一个屏幕放下，页面无横向或纵向滚动');
        await page.waitForFunction(() => [...document.querySelectorAll('.member-avatar img')].every(img => img.complete && img.naturalWidth > 0));
        await page.locator('.home-members').evaluate(async region => {
          await Promise.all(region.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
        });
        const memberBounds = await page.evaluate(() => {
          const elements = [...document.querySelectorAll('.member-profile, .member-avatar, .member-name, .member-intro, .member-link')];
          const outside = elements.filter(element => {
            const box = element.getBoundingClientRect();
            return box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1;
          }).map(element => `${element.closest('.member-profile').dataset.memberId}: ${element.className}`);
          const parts = elements.filter(element => !element.classList.contains('member-profile'));
          const collisions = [];
          for (let index = 0; index < parts.length; index++) {
            const box = parts[index].getBoundingClientRect();
            for (const other of parts.slice(index + 1)) {
              const otherBox = other.getBoundingClientRect();
              if (box.left < otherBox.right - 1 && box.right > otherBox.left + 1 &&
                box.top < otherBox.bottom - 1 && box.bottom > otherBox.top + 1) {
                collisions.push(`${parts[index].closest('.member-profile').dataset.memberId}: ${parts[index].className} / ${other.closest('.member-profile').dataset.memberId}: ${other.className}`);
              }
            }
          }
          return { outside, collisions };
        });
        assert.deepEqual(memberBounds.outside, [], '每位成员及头像、名称、介绍、链接完整位于视口内');
        assert.deepEqual(memberBounds.collisions, [], '头像、名称、介绍与链接的实际边界不应相互遮挡');
        assert.equal(await page.locator('.member-profile').evaluateAll(profiles => {
          const boxes = profiles.map(profile => profile.getBoundingClientRect());
          return boxes.every((box, index) => boxes.slice(index + 1).every(other =>
            box.right <= other.left || box.left >= other.right || box.bottom <= other.top || box.top >= other.bottom));
        }), true, '成员头像、名称、介绍与链接不应相互遮挡');
      } else assert.equal(await page.locator('.home-placeholder h2').innerText(), text);
      await checkLayout(page, width, height);
      if (panel === 'projects') {
        await page.locator('.home-expand').click();
        await page.waitForSelector('.home[data-layout="all"] .home-panel[aria-busy="false"]');
        await expectBlurredHomeScene(page, scene);
        assert.equal(await page.locator('.home-placeholder h2').innerText(), text);
        await checkLayout(page, width, height);
      } else assert.equal(await page.locator('.home-expand').count(), 0);
      await goHome(page);
      assert.equal(await page.locator('.home').getAttribute('data-layout'), 'list');
    }
    await ctx.close();
    console.log(`✓ ${width}×${height} 首页／大厅／占位栏目／返回与焦点`);
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(BASE);
  await page.getByRole('textbox', { name: '玩家昵称' }).fill('小鳄龙测试');
  await page.reload();
  assert.equal(await page.getByRole('textbox', { name: '玩家昵称' }).inputValue(), '小鳄龙测试');
  await page.getByRole('textbox', { name: '玩家昵称' }).fill('');
  await page.getByRole('textbox', { name: '玩家昵称' }).blur();
  assert.equal(await page.getByRole('textbox', { name: '玩家昵称' }).inputValue(), '你');
  assert.equal(
    await page.getByRole('textbox', { name: '玩家昵称' }).getAttribute('maxlength'),
    '8',
  );
  await page.getByRole('button', { name: '首页音效', exact: true }).click();
  await page.getByRole('button', { name: '首页动效', exact: true }).click();
  await page.reload();
  assert.equal(
    await page.getByRole('button', { name: '首页音效', exact: true }).getAttribute('aria-pressed'),
    'false',
  );
  assert.equal(await page.locator('.home').getAttribute('data-motion'), 'off');
  await openHall(page);
  await page.getByRole('button', { name: /出包魔法师/ }).click();
  await page.waitForSelector('.detail-panel');
  await page.getByRole('button', { name: '🎮 开始（本地 vs AI）', exact: true }).click();
  await page.waitForSelector('.game-page');
  assert.equal(await page.locator('.magic-btn').count(), 8);
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await page.waitForSelector('.detail-panel');
  await page.getByRole('button', { name: '← 返回游戏大厅', exact: true }).click();
  await ready(page, 'hall');
  await page.getByRole('button', { name: /鳄龙咆哮/ }).click();
  await page.waitForSelector('.ccf-detail-panel');
  await page.getByRole('button', { name: /返回游戏大厅/ }).click();
  await ready(page, 'hall');
  await goHome(page);
  await page.getByRole('button', { name: '首页动效', exact: true }).click();
  // 两次立即激活不同入口，只接受第一次，避免快速点击跳过面板。
  await page.locator('[data-home-entry="hall"]').evaluate((el) => {
    el.click();
    document.querySelector('[data-home-entry="projects"]').click();
  });
  await ready(page, 'hall');
  assert.equal(await page.locator('.home').getAttribute('data-panel'), 'hall');
  await goHome(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.home')?.dataset.motion === 'off');
  assert.equal(await page.locator('.home').getAttribute('data-motion'), 'off');
  await openHall(page);
  assert.equal(await page.locator('.home-click-ring').count(), 0);
  await ctx.close();
  console.log('✓ 昵称／偏好保存／游戏进入退出／快速点击／减少动态效果');

  for (const blockedStorage of [false, true]) {
    const fallback = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (blockedStorage)
      await fallback.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new Error('storage unavailable');
          },
        });
      });
    const p = await fallback.newPage();
    p.on('pageerror', (error) => errors.push(error.message));
    await p.route(/\/(characters|hall)\/.*\.(png|webp)(\?.*)?$/, (route) => route.abort());
    await p.goto(BASE);
    await p.waitForSelector('.home-scene--fallback');
    await p.getByRole('textbox', { name: '玩家昵称' }).fill('依旧能玩');
    await openHall(p);
    await p.waitForSelector('.home-game-fallback');
    assert.equal(await p.locator('.home-game').count(), 4);
    await p.locator('[data-game-id="trouble-magician"]').click();
    await p.waitForSelector('.detail-panel');
    await fallback.close();
  }
  assert.deepEqual(errors, [], '浏览器运行错误');
  console.log('✓ 图片失败／存储不可用仍可进入游戏');
} finally {
  await browser.close();
}
