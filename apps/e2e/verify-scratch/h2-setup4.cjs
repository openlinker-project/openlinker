const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1300 } });
    await page.goto(BASE + '/login', { waitUntil: 'load', timeout: 20000 });
    const userField = await page.$('input[name="username"]');
    if (userField) await userField.fill('admin');
    await page.fill('input[type="password"]', 'admin');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);

    await page.goto(BASE + '/settings/sales-documents', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1200);
    const plRow = page.locator('.sales-document-market-row').filter({ has: page.locator('.sales-document-market-row__name', { hasText: /^PL$/ }) });
    await plRow.getByRole('button', { name: /Configure/ }).click();
    await page.waitForTimeout(800);

    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.waitForTimeout(500);
    let rows = page.locator('.rule-composer-condition-row');
    await rows.nth(0).locator('select').first().selectOption({ label: 'Buyer has a tax ID' });
    await rows.nth(0).locator('select').nth(1).selectOption({ label: 'yes' });
    await page.getByRole('button', { name: '+ Add condition' }).click();
    await page.waitForTimeout(300);
    rows = page.locator('.rule-composer-condition-row');
    const thresholdRowSelects = rows.nth(1).locator('select');
    await thresholdRowSelects.nth(0).selectOption({ label: 'Order total (gross)' });
    await page.waitForTimeout(300);
    const selCount = await thresholdRowSelects.count();
    console.log('selects in threshold row:', selCount);
    const opts1 = await thresholdRowSelects.nth(1).locator('option').allTextContents();
    console.log('comparison options:', opts1);
    const opts2 = await thresholdRowSelects.nth(2).locator('option').allTextContents();
    console.log('threshold ref options:', opts2);
  } finally {
    await browser.close();
  }
})();
