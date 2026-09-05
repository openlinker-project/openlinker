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

    // Rule A: buyerHasTaxId=true AND total >= 1000 -> Invoice via inFakt
    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.waitForTimeout(500);
    let rows = page.locator('.rule-composer-condition-row');
    await rows.nth(0).locator('select').first().selectOption({ label: 'Buyer has a tax ID' });
    await rows.nth(0).locator('select').nth(1).selectOption({ label: 'yes' });
    await page.getByRole('button', { name: '+ Add condition' }).click();
    await page.waitForTimeout(300);
    rows = page.locator('.rule-composer-condition-row');
    const r2sel = rows.nth(1).locator('select');
    await r2sel.nth(0).selectOption({ label: 'Order total (gross)' });
    await page.waitForTimeout(300);
    await r2sel.nth(1).selectOption({ label: '≥' });
    await r2sel.nth(2).selectOption({ label: 'pl-full-invoice-1000-2026 (1000 PLN)' });
    await page.locator('#sd-rule-doctype').selectOption({ label: 'Invoice' });
    await page.locator('#sd-rule-connection').selectOption({ label: 'inFakt' });
    await page.screenshot({ path: OUT + '/H2-6-ruleA-ready.png' });
    await page.getByRole('button', { name: 'Save rule' }).click();
    await page.waitForTimeout(1000);
    console.log('rule A saved');

    // Rule B: buyerHasTaxId=true AND total >= 450 AND total < 1000 -> Invoice via KSeF
    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.waitForTimeout(500);
    rows = page.locator('.rule-composer-condition-row');
    await rows.nth(0).locator('select').first().selectOption({ label: 'Buyer has a tax ID' });
    await rows.nth(0).locator('select').nth(1).selectOption({ label: 'yes' });
    await page.getByRole('button', { name: '+ Add condition' }).click();
    await page.waitForTimeout(300);
    rows = page.locator('.rule-composer-condition-row');
    const rBsel1 = rows.nth(1).locator('select');
    await rBsel1.nth(0).selectOption({ label: 'Order total (gross)' });
    await page.waitForTimeout(300);
    await rBsel1.nth(1).selectOption({ label: '≥' });
    await rBsel1.nth(2).selectOption({ label: 'pl-simplified-invoice-2026 (450 PLN)' });
    await page.getByRole('button', { name: '+ Add condition' }).click();
    await page.waitForTimeout(300);
    rows = page.locator('.rule-composer-condition-row');
    const rBsel2 = rows.nth(2).locator('select');
    await rBsel2.nth(0).selectOption({ label: 'Order total (gross)' });
    await page.waitForTimeout(300);
    await rBsel2.nth(1).selectOption({ label: '<' });
    await rBsel2.nth(2).selectOption({ label: 'pl-full-invoice-1000-2026 (1000 PLN)' });
    await page.locator('#sd-rule-doctype').selectOption({ label: 'Invoice' });
    await page.locator('#sd-rule-connection').selectOption({ label: 'KSeF (direct, test)' });
    await page.screenshot({ path: OUT + '/H2-7-ruleB-ready.png' });
    await page.getByRole('button', { name: 'Save rule' }).click();
    await page.waitForTimeout(1000);
    console.log('rule B saved');
    await page.screenshot({ path: OUT + '/H2-8-all-rules.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
