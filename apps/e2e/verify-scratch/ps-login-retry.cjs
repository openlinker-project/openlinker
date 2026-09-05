const { chromium } = require('playwright');
const PS_BASE = 'http://localhost:18080/admin-dev';
const OUT = __dirname + '/screenshots';

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
    await page.goto(PS_BASE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 10000 });
    await page.fill('input[name="email"]', 'demo@prestashop.com');
    await page.fill('input[name="passwd"]', 'prestashop_demo');
    await page.waitForTimeout(300);
    const emailVal = await page.locator('input[name="email"]').inputValue();
    const pwVal = await page.locator('input[name="passwd"]').inputValue();
    console.log('email:', emailVal, 'pwLen:', pwVal.length);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    console.log('URL:', page.url());
    await page.screenshot({ path: OUT + '/PSL1-result.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
