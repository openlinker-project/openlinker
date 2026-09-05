const { chromium } = require('playwright');
const OUT = __dirname + '/screenshots';
const WEB_BASE = 'http://localhost:8090';
const ORDER_ID = 'ol_order_dfc9347828fa468da2a1cc6b5c63d09e';

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ storageState: OUT + '/../ol-admin-state.json', viewport: { width: 1500, height: 1800 } });
    const page = await context.newPage();
    await page.goto(`${WEB_BASE}/orders/${ORDER_ID}`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: OUT + '/H3-tier1-order-detail-blocked.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
