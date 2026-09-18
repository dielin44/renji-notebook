const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  fs.mkdirSync('browser-qa', { recursive: true });
  try {
    for (const width of [360, 390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: true, serviceWorkers: 'block' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://app.test/**', route => {
        const name = new URL(route.request().url()).pathname.slice(1) || 'index.html';
        const file = path.resolve('app/src/main/assets/web', name);
        return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
      });
      await page.goto('http://app.test/');
      await page.waitForSelector('[data-action="nav"]');
      await page.evaluate(async () => {
        await window.RenjiStore.saveState(window.RenjiLogic.createDemoState());
      });
      await page.reload();
      await page.locator('[data-action="nav"][data-view="settings"]').click();
      assert.equal(await page.locator('.theme-option').count(), 8);
      await page.locator('.theme-pager').screenshot({ path: `browser-qa/themes-first-${width}.png` });
      await page.locator('[data-theme-swipe]').evaluate(el => {
        el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [new Touch({identifier:1,target:el,clientX:40,clientY:200})] }));
        el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [new Touch({identifier:1,target:el,clientX:180,clientY:202})] }));
      });
      assert.equal(await page.locator('.theme-option').count(), 8);
      assert.equal(await page.locator('[data-theme="custom"]').count(), 1);
      for (const color of ['#112233', '#ffffff', '#00aabb']) {
        const index = ['#112233', '#ffffff', '#00aabb'].indexOf(color);
        await page.locator(`[data-custom-theme-color="${index}"]`).fill(color);
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'custom');
        await page.waitForTimeout(120);
      }
      assert.deepEqual(await page.evaluate(async () => (await window.RenjiStore.loadState()).settings.customThemeColors), ['#112233','#ffffff','#00aabb']);
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'custom');
      await page.locator('[data-action="nav"][data-view="settings"]').click();
      await page.locator('[data-theme-page="1"]').click();
      await page.locator('[data-theme="forest"]').click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'forest');
      await page.locator('.theme-pager').screenshot({ path: `browser-qa/themes-second-${width}.png` });
      await page.locator('[data-action="nav"][data-view="journal"]').click();
      for (const tone of ['urgent','soon','month','later','overdue','done','note']) {
        assert.equal(await page.locator(`.journal-card.status-${tone}`).count(), 1, tone);
      }
      await page.screenshot({ path: `browser-qa/journal-${width}.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Browser QA passed: 360, 390 and 1280 px, swipe, custom persistence, seven journal tones.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
