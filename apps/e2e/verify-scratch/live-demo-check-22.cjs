const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';
const ORDER = 'ol_order_d5fee0999de24cb891057c3ffc2cc6bf';

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(BASE + '/login', { waitUntil: 'load', timeout: 20000 });
    const userField = await page.$('input[name="username"]');
    if (userField) await userField.fill('admin');
    await page.fill('input[type="password"]', 'admin');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);

    await page.goto(BASE + '/orders/' + ORDER, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1500);
    const disc = page.locator('summary', { hasText: 'Issue correction' });
    const count = await disc.count();
    console.log('Issue correction count:', count);
    if (count > 0) {
      await disc.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: OUT + '/T-issue-correction-open.png', fullPage: true });
    }
  } finally {
    await browser.close();
  }
})();
