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
  const context = await browser.newContext({ viewport: { width: 375, height: 900 } });
  const page = await context.newPage();
  await login(page);
  await gotoListings(page);
  await page.waitForTimeout(1200);

  const disclosureBtn = page.getByRole('button', { name: /view full details/i }).first();
  if ((await disclosureBtn.count()) > 0) {
    await disclosureBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOT_DIR, '06b-phone-card-expanded-fixed.png') });
  } else {
    console.log('DISCLOSURE BUTTON NOT FOUND');
  }

  // Tab bar scroll reachability check
  const tabsList = page.locator('[role="tablist"]').first();
  const scrollInfo = await tabsList.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
  }));
  console.log('TABS_SCROLL_INFO:', JSON.stringify(scrollInfo));

  const unsyncedTab = page.getByRole('tab', { name: /Unsynced/ });
  await unsyncedTab.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const isVisible = await unsyncedTab.isVisible();
  console.log('UNSYNCED_TAB_VISIBLE_AFTER_SCROLL:', isVisible);
  await unsyncedTab.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOT_DIR, '08-phone-unsynced-tab-scrolled.png') });

  await context.close();
  await browser.close();
  console.log('DONE2');
}
main().catch((e) => { console.error(e); process.exit(1); });
