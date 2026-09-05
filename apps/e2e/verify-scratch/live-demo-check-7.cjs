const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  const userField = await page.$('input[name="username"]');
  if (userField) await userField.fill('admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  await page.goto(BASE + '/orders', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  // Filter by source = PrestaShop (the only source with real tax rates / buyer tax id)
  const sourceSelect = page.locator('select').first();
  await sourceSelect.selectOption({ label: 'PrestaShop (demo store)' }).catch(async () => {
    const opts = await sourceSelect.locator('option').allTextContents();
    console.log('AVAILABLE SOURCE OPTIONS:', opts);
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + '/I-orders-prestashop-filtered.png', fullPage: true });

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
