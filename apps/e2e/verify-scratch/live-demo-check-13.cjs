const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let captured = null;
  page.on('request', (req) => {
    if (req.url().includes('/v1/orders') && !captured) {
      captured = { url: req.url(), headers: req.headers() };
    }
  });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 20000 });
  const userField = await page.$('input[name="username"]');
  if (userField) await userField.fill('admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  await page.goto(BASE + '/orders', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);
  console.log(JSON.stringify(captured, null, 2));
  const cookies = await page.context().cookies();
  console.log('COOKIES:', JSON.stringify(cookies.map(c => ({ name: c.name, domain: c.domain })), null, 2));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
