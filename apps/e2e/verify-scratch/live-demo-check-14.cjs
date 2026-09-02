const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1500 } });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 20000 });
  const userField = await page.$('input[name="username"]');
  if (userField) await userField.fill('admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  await page.goto(BASE + '/orders/ol_order_2befa98c3e734c81a5b22a3d9f3aa4ab', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + '/M-kulus-order-30pln.png', fullPage: true });

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
