import { chromium } from 'playwright';

const BASE = 'http://localhost:38090';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.getByPlaceholder('Username or email').fill('admin');
await page.getByPlaceholder('Enter your password').fill('admin');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(1800);

await page.goto(`${BASE}/fulfillment`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

const bench = page.getByRole('link', { name: 'Pack bench' });
console.log('Pack bench sidebar entries:', await bench.count());
if ((await bench.count()) > 0) {
  console.log('  href:', await bench.first().getAttribute('href'));
  await bench.first().scrollIntoViewIfNeeded();
}
await page.screenshot({ path: '/tmp/apw-screenshots/stages/4-fixes--sidebar.png', fullPage: false });
await browser.close();
