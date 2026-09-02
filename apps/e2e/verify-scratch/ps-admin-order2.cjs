const { chromium } = require('playwright');
const PS_BASE = 'http://localhost:18080/admin-dev';
const OUT = __dirname + '/screenshots';

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
    await page.goto(PS_BASE, { waitUntil: 'load', timeout: 20000 });
    await page.fill('input[name="email"], #email', 'demo@prestashop.com');
    await page.fill('input[name="passwd"]', 'prestashop_demo');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: OUT + '/PS2-after-login.png' });
    console.log('URL after login:', page.url());
  } finally {
    await browser.close();
  }
})();
