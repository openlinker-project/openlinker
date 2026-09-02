const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  const userField = await page.$('input[name="username"]');
  if (userField) await userField.fill('admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  await page.goto(BASE + '/settings/sales-documents', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const btns = await page.$$('button:has-text("Configure")');
  await btns[1].click();
  await page.waitForTimeout(1000);
  await page.click('button:has-text("Add rule")');
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/E-rule-composer-modal.png', fullPage: true });

  // Hover the warning glyph if present
  const glyph = page.locator('[aria-label*="tax"], button:has-text("!"), svg').first();
  await page.screenshot({ path: OUT + '/E2-rule-composer-modal-full.png' });

  await browser.close();
  console.log(JSON.stringify({ errorCount: errors.length, errors }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
