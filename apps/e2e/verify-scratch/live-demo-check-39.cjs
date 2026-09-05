const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(BASE + '/login', { waitUntil: 'load', timeout: 20000 });
    const userField = await page.$('input[name="username"]');
    if (userField) await userField.fill('admin');
    await page.fill('input[type="password"]', 'admin');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);

    await page.goto(BASE + '/settings/sales-documents', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1200);
    const deRow = page.locator('.sales-document-market-row').filter({ has: page.locator('.sales-document-market-row__name', { hasText: /^DE$/ }) });
    await deRow.getByRole('button', { name: /Configure/ }).click();
    await page.waitForTimeout(800);
    const resetBtn = page.getByRole('button', { name: 'Reset country' });
    await resetBtn.waitFor({ state: 'visible', timeout: 5000 });
    await resetBtn.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: OUT + '/AQ-de-reset-confirm-copy.png' });
    // Cancel out - do NOT actually reset DE's real rule.
    const cancelBtn = page.getByRole('button', { name: /Cancel|No, keep/i });
    if (await cancelBtn.count() > 0) await cancelBtn.click();
  } finally {
    await browser.close();
  }
})();
