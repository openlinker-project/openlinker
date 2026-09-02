const { chromium } = require('playwright');
const PS_BASE = 'http://localhost:18080/admin-dev';
const OUT = __dirname + '/screenshots';

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1700, height: 1200 } });
    const page = await context.newPage();
    await page.goto(PS_BASE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 10000 });
    await page.fill('input[name="email"]', 'demo@prestashop.com');
    await page.fill('input[name="passwd"]', 'prestashop_demo');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await context.storageState({ path: OUT + '/../ps-admin-state.json' });
    console.log('logged in, dashboard URL:', page.url());

    // Find the "Add new order" link (AdminOrders controller, addorder action)
    await page.goto(PS_BASE + '/index.php?controller=AdminOrders&addorder' + '&token=' + new URL(page.url()).searchParams.get('token'), { waitUntil: 'networkidle', timeout: 20000 }).catch(async (e) => {
      console.log('direct nav failed:', e.message);
    });
    await page.waitForTimeout(1500);
    console.log('URL after nav attempt:', page.url());
    await page.screenshot({ path: OUT + '/PSA1-orders-new.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
