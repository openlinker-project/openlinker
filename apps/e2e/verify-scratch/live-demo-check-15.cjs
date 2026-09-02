const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';
const ORDER = 'ol_order_2befa98c3e734c81a5b22a3d9f3aa4ab';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 20000 });
  const userField = await page.$('input[name="username"]');
  if (userField) await userField.fill('admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  await page.goto(BASE + '/orders/' + ORDER, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.click('text=Issue or register manually instead');
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/N-before-register-receipt.png' });

  const registerBtn = page.getByRole('button', { name: 'Register receipt' });
  await registerBtn.click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: OUT + '/O-after-register-receipt.png', fullPage: true });

  console.log(JSON.stringify({ errors }, null, 2));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
