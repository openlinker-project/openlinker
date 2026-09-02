const { chromium } = require('playwright');
const OUT = __dirname + '/screenshots';
(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ storageState: OUT + '/../ol-admin-state.json', viewport: { width: 1500, height: 1800 } });
    const page = await context.newPage();
    await page.goto('http://localhost:8090/orders/ol_order_d5fee0999de24cb891057c3ffc2cc6bf', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: OUT + '/D3-accepted-cleared.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
