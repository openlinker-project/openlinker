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

    // Delete the "≥ threshold → inFakt" rule (2nd rule card, no end date, has "Invoice · inFakt")
    const inFaktRuleCard = page.locator('div').filter({ hasText: 'Invoice · inFakt' }).filter({ has: page.getByRole('button', { name: 'Delete' }) }).last();
    await inFaktRuleCard.getByRole('button', { name: 'Delete' }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: OUT + '/H2-3-after-delete.png' });

    // Add rule 1: buyerHasTaxId=true AND total>=1000 -> Invoice via inFakt
    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.waitForTimeout(500);
    let rows = page.locator('.rule-composer-condition-row');
    await rows.nth(0).locator('select').first().selectOption({ label: 'Buyer has a tax ID' });
    await rows.nth(0).locator('select').nth(1).selectOption({ label: 'yes' });
    const addCond = page.getByRole('button', { name: '+ Add condition' });
    await addCond.click();
    await page.waitForTimeout(300);
    rows = page.locator('.rule-composer-condition-row');
    await rows.nth(1).locator('select').first().selectOption({ label: 'Order total (gross)' });
    await page.waitForTimeout(300);
    await rows.nth(1).locator('select').nth(1).selectOption({ label: '≥' });
    await rows.nth(1).locator('input').first().fill('1000');
    await page.locator('#sd-rule-doctype').selectOption({ label: 'Invoice' });
    await page.locator('#sd-rule-connection').selectOption({ label: 'inFakt' });
    await page.screenshot({ path: OUT + '/H2-4-rule1-ready.png' });
    await page.getByRole('button', { name: 'Save rule' }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: OUT + '/H2-5-after-rule1.png' });
  } finally {
    await browser.close();
  }
})();
