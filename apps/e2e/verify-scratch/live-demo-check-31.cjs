const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(BASE + '/login', { waitUntil: 'load', timeout: 20000 });
    const userField = await page.$('input[name="username"]');
    if (userField) await userField.fill('admin');
    await page.fill('input[type="password"]', 'admin');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);

    await page.goto(BASE + '/settings/sales-documents', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1200);

    await page.getByRole('combobox', { name: 'New market country' }).click();
    await page.getByPlaceholder(/Type to search/i).fill('Spain');
    await page.waitForTimeout(600);
    await page.getByText('Spain', { exact: true }).click();
    await page.getByRole('button', { name: 'Add a market' }).click();
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.waitForTimeout(500);

    // Simplify: single condition, orderCountry = ES, Invoice via inFakt.
    const rows = page.locator('.rule-composer-condition-row');
    await rows.nth(0).locator('select').first().selectOption({ label: 'Order country is' });
    await page.waitForTimeout(300);
    await rows.nth(0).locator('input').first().fill('ES');

    await page.locator('#sd-rule-doctype').selectOption({ label: 'Invoice' }).catch(async () => {
      const docSel = page.locator('.dialog__content--elevated select').filter({ hasText: 'Invoice' });
      await docSel.first().selectOption({ label: 'Invoice' });
    });
    await page.locator('#sd-rule-connection').selectOption({ label: 'inFakt' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: OUT + '/AG-ready-to-save.png' });

    const saveBtn = page.getByRole('button', { name: 'Save rule' });
    console.log('save disabled:', await saveBtn.isDisabled());
    await saveBtn.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: OUT + '/AH-rule-saved.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
