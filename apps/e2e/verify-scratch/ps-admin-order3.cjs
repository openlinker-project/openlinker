const { chromium } = require('playwright');
const PS_BASE = 'http://localhost:18080/admin-dev';
const OUT = __dirname + '/screenshots';

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
    await page.goto(PS_BASE, { waitUntil: 'load', timeout: 20000 });
    await page.waitForSelector('input[name="email"]', { timeout: 10000 });
    await page.fill('input[name="email"]', 'demo@prestashop.com');
    const pwCount = await page.locator('input[name="passwd"]').count();
    console.log('passwd field count:', pwCount);
    await page.locator('input[name="passwd"]').first().click();
    await page.locator('input[name="passwd"]').first().fill('prestashop_demo');
    const val = await page.locator('input[name="passwd"]').first().inputValue();
    console.log('passwd value after fill:', val);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: OUT + '/PS3-after-login.png' });
    console.log('URL:', page.url());
  } finally {
    await browser.close();
  }
})();
