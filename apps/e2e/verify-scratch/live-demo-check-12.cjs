const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 20000 });
  const userField = await page.$('input[name="username"]');
  if (userField) await userField.fill('admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  console.log('LS KEYS:', keys);
  for (const k of keys) {
    const v = await page.evaluate((kk) => localStorage.getItem(kk), k);
    console.log(k, '=>', v.slice(0, 200));
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
