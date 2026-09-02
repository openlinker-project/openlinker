const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';
const ORDER = 'ol_order_26ef55f82bb24bf3a608887dcbcdaf3e';

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1300 } });
    await page.goto(BASE + '/login', { waitUntil: 'load', timeout: 20000 });
    const userField = await page.$('input[name="username"]');
    if (userField) await userField.fill('admin');
    await page.fill('input[type="password"]', 'admin');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);

    await page.goto(BASE + '/orders/' + ORDER, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1500);
    const disc = page.locator('text=Issue or register manually instead');
    if (await disc.isVisible().catch(() => false)) {
      await disc.click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: OUT + '/U-before-click.png' });

    const issueBtn = page.getByRole('button', { name: 'Issue invoice' });
    await issueBtn.click();
    // Capture the loading state IMMEDIATELY and repeatedly, not after a fixed delay.
    await page.waitForTimeout(200);
    await page.screenshot({ path: OUT + '/V-loading-state-200ms.png' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: OUT + '/W-loading-state-1s.png' });
  } finally {
    await browser.close();
  }
})();
