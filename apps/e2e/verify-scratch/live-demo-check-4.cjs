const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  const userField = await page.$('input[name="username"]');
  if (userField) await userField.fill('admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  await page.goto(BASE + '/orders', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // Find first order link
  const link = page.locator('a[href*="/orders/"]').first();
  await link.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + '/F-order-detail.png', fullPage: true });

  await browser.close();
  console.log(JSON.stringify({ errorCount: errors.length, errors }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
