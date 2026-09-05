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

    const addConditionBtn = page.getByRole('button', { name: '+ Add condition' });
    await addConditionBtn.click();
    await page.waitForTimeout(400);
    await addConditionBtn.click();
    await page.waitForTimeout(400);

    const rows = page.locator('.rule-composer-condition-row');
    console.log('row count:', await rows.count());

    // Row 1 (index 1) -> Order country
    const row1FieldSelect = rows.nth(1).locator('select').first();
    await row1FieldSelect.selectOption({ label: 'Order country is' });
    await page.waitForTimeout(400);
    const row1Html = (await rows.nth(1).innerHTML()).replace(/\s+/g, ' ').slice(0, 500);
    console.log('row1 after selecting Order country:', row1Html);

    // Row 2 (index 2) -> Order total
    const row2FieldSelect = rows.nth(2).locator('select').first();
    await row2FieldSelect.selectOption({ label: 'Order total (gross)' });
    await page.waitForTimeout(400);
    const row2Html = (await rows.nth(2).innerHTML()).replace(/\s+/g, ' ').slice(0, 500);
    console.log('row2 after selecting Order total:', row2Html);

    await page.screenshot({ path: OUT + '/AD-distinct-condition-shapes.png' });
  } finally {
    await browser.close();
  }
})();
