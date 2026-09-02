const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  const userField = await page.$('input[name="username"]');
  if (userField) await userField.fill('admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  await page.goto(BASE + '/orders', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('a[href*="/orders/"]').first().click();
  await page.waitForTimeout(1200);
  const disclosure = page.locator('text=Issue or register manually instead');
  await disclosure.click();
  await page.waitForTimeout(600);
  const salesDocSection = page.locator('text=Sales document').first();
  await salesDocSection.scrollIntoViewIfNeeded();
  await page.screenshot({ path: OUT + '/G-order-panel-override-cards.png', fullPage: true });
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
