const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';
const ORDER = 'phase4-qa-order-004';

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
    await page.screenshot({ path: OUT + '/AL-duplicate-invoice-order.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
