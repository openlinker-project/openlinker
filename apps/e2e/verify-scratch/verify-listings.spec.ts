import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const BASE = 'http://localhost:4173';
const SHOT_DIR = path.join(__dirname, 'screenshots');

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder(/username or email/i).fill('admin');
  await page.getByPlaceholder(/enter your password/i).fill('admin');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard)?$/, { timeout: 15000 }).catch(() => {});
}

async function gotoListings(page: Page): Promise<void> {
  await page.evaluate(() => {
    history.pushState({}, '', '/listings');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForTimeout(1500);
}

test.describe('Listings redesign visual verification', () => {
  test('desktop: default view, tabs, table', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await login(page);
    await gotoListings(page);
    await page.waitForSelector('table, .data-table', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SHOT_DIR, '01-desktop-default-active-tab.png') });

    // Switch through each lifecycle tab
    for (const tabName of ['Inactive', 'Draft', 'Ended', 'Unsynced']) {
      const tab = page.getByRole('tab', { name: new RegExp(tabName) });
      if (await tab.count()) {
        await tab.first().click();
        await page.waitForTimeout(800);
        await page.screenshot({
          path: path.join(SHOT_DIR, `02-desktop-tab-${tabName.toLowerCase()}.png`),
        });
      }
    }
    // Back to Active
    const activeTab = page.getByRole('tab', { name: /Active/ });
    if (await activeTab.count()) await activeTab.first().click();
    await page.waitForTimeout(500);

    // Toolbar: channel select options (verify PrestaShop connection excluded)
    const select = page.locator('select[aria-label="Filter by channel"]');
    if (await select.count()) {
      const options = await select.locator('option').allTextContents();
      console.log('CHANNEL_SELECT_OPTIONS:', JSON.stringify(options));
    }

    // Search
    const search = page.getByPlaceholder(/product name, sku, ean/i);
    if (await search.count()) {
      await search.fill('Keyboard');
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(SHOT_DIR, '03-desktop-search-filtered.png') });
      await search.fill('');
      await page.waitForTimeout(500);
    }

    // Clear button + tab bar wrap check at narrower desktop width
    await context.close();
  });

  test('tablet: 768px wrap behaviour', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 768, height: 1000 } });
    const page = await context.newPage();
    await login(page);
    await gotoListings(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOT_DIR, '04-tablet-768.png') });
    await context.close();
  });

  test('phone: 375px card view + toolbar wrap', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
    const page = await context.newPage();
    await login(page);
    await gotoListings(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOT_DIR, '05-phone-375-cards.png'), fullPage: false });

    // Expand one card's disclosure if present
    const disclosure = page.locator('.data-table__card button, .data-table__card [aria-expanded]').first();
    if (await disclosure.count()) {
      await disclosure.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SHOT_DIR, '06-phone-card-expanded.png') });
    }
    await context.close();
  });

  test('focus ring on row link (keyboard nav)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await login(page);
    await gotoListings(page);
    await page.waitForTimeout(1200);
    // Tab into the page a few times to reach the first row link
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
    }
    await page.screenshot({ path: path.join(SHOT_DIR, '07-focus-ring-check.png') });
    await context.close();
  });
});
