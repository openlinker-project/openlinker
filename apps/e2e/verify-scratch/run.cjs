const path = require('node:path');
const pw = require('/home/nor/projekty/blocky/openlinker-pnpm-10/.worktrees/verify-2023/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const { chromium } = pw;

const BASE = 'http://localhost:4173';
const SHOT_DIR = path.join(__dirname, 'screenshots');

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder(/username or email/i).fill('admin');
  await page.getByPlaceholder(/enter your password/i).fill('admin');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(1500);
}

async function gotoListings(page) {
  await page.evaluate(() => {
    history.pushState({}, '', '/listings');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForTimeout(1500);
}

async function main() {
  const browser = await chromium.launch({ args: ['--disable-web-security'] });

  // --- Desktop ---
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await login(page);
    await gotoListings(page);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SHOT_DIR, '01-desktop-default-active-tab.png') });

    const tabs = ['Inactive', 'Draft', 'Ended', 'Unsynced'];
    for (const tabName of tabs) {
      const tab = page.getByRole('tab', { name: new RegExp(tabName) });
      if ((await tab.count()) > 0) {
        await tab.first().click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(SHOT_DIR, `02-desktop-tab-${tabName.toLowerCase()}.png`) });
      } else {
        console.log(`TAB NOT FOUND: ${tabName}`);
      }
    }
    const activeTab = page.getByRole('tab', { name: /Active/ });
    if ((await activeTab.count()) > 0) await activeTab.first().click();
    await page.waitForTimeout(500);

    const select = page.locator('select[aria-label="Filter by channel"]');
    if ((await select.count()) > 0) {
      const options = await select.locator('option').allTextContents();
      console.log('CHANNEL_SELECT_OPTIONS:', JSON.stringify(options));
    } else {
      console.log('CHANNEL SELECT NOT FOUND');
    }

    const search = page.getByPlaceholder(/product name, sku, ean/i);
    if ((await search.count()) > 0) {
      await search.fill('Keyboard');
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(SHOT_DIR, '03-desktop-search-filtered.png') });
      // Clear button check
      const clearBtn = page.getByRole('button', { name: /^Clear$/ });
      if ((await clearBtn.count()) > 0) {
        await clearBtn.first().click();
        await page.waitForTimeout(500);
        console.log('CLEAR BUTTON CLICKED');
      }
    } else {
      console.log('SEARCH INPUT NOT FOUND');
    }
    await page.screenshot({ path: path.join(SHOT_DIR, '03b-desktop-after-clear.png') });

    // Focus ring check
    for (let i = 0; i < 10; i++) await page.keyboard.press('Tab');
    await page.screenshot({ path: path.join(SHOT_DIR, '07-focus-ring-check.png') });

    await context.close();
  }

  // --- Tablet 768 ---
  {
    const context = await browser.newContext({ viewport: { width: 768, height: 1000 } });
    const page = await context.newPage();
    await login(page);
    await gotoListings(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOT_DIR, '04-tablet-768.png') });
    await context.close();
  }

  // --- Phone 375 ---
  {
    const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
    const page = await context.newPage();
    await login(page);
    await gotoListings(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOT_DIR, '05-phone-375-cards.png') });

    const disclosure = page.locator('.data-table__card button, .data-table__card [aria-expanded]').first();
    if ((await disclosure.count()) > 0) {
      await disclosure.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SHOT_DIR, '06-phone-card-expanded.png') });
    } else {
      console.log('MOBILE DISCLOSURE NOT FOUND');
    }
    await context.close();
  }

  await browser.close();
  console.log('DONE');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
