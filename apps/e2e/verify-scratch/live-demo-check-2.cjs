const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('403')) errors.push(m.text()); });

  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  const userField = await page.$('input[name="username"]');
  if (userField) await userField.fill('admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  // PL routing dialog
  await page.goto(BASE + '/settings/sales-documents', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const plRow = page.locator('text=PL').first();
  await plRow.scrollIntoViewIfNeeded();
  const rows = await page.$$('li, tr');
  // Click the Configure button in the PL row specifically
  const plConfigure = page.locator('text=PL').locator('xpath=ancestor::*[self::li or self::tr][1]').locator('button:has-text("Configure")');
  await plConfigure.click({ timeout: 5000 }).catch(async () => {
    // fallback: click 2nd Configure button (DE=1st, PL=2nd)
    const btns = await page.$$('button:has-text("Configure")');
    if (btns[1]) await btns[1].click();
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + '/D-pl-routing-dialog.png', fullPage: true });

  await browser.close();
  console.log(JSON.stringify({ errorCount: errors.length, errors: errors.slice(0, 15) }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
