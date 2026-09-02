const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  const userField = await page.$('input[name="username"]');
  if (userField) await userField.fill('admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  await page.goto(BASE + '/orders', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const sourceSelect = page.locator('select').first();
  await sourceSelect.selectOption({ label: 'PrestaShop (demo store)' });
  await page.waitForTimeout(1200);

  // Click order "21" row (Anna Testowa)
  await page.locator('text=Anna Testowa').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + '/J-order-21-detail.png', fullPage: true });

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
