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
    await page.waitForTimeout(300);
    await addConditionBtn.click();
    await page.waitForTimeout(300);

    const fieldSelects = await page.locator('.dialog__content--elevated .rule-composer-condition-row select').all();
    await fieldSelects[2].selectOption({ label: 'Order country is' });
    await page.waitForTimeout(300);
    await fieldSelects[4].selectOption({ label: 'Order total (gross)' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: OUT + '/AD-distinct-condition-shapes.png' });

    const rows = await page.locator('.rule-composer-condition-row').all();
    console.log('condition row count:', rows.length);
    for (let i = 0; i < rows.length; i++) {
      const html = await rows[i].innerHTML();
      console.log('--- row', i, '---', html.replace(/\s+/g, ' ').slice(0, 300));
    }

    // Fill required values and connection, then save.
    const countryValueInput = page.locator('.dialog__content--elevated .rule-composer-condition-row').nth(1).locator('select, input').nth(1);
    // Try to set the connection selector so save is valid
    const connectionSelect = page.locator('#sd-rule-connection');
    if (await connectionSelect.count() > 0) {
      await connectionSelect.selectOption({ label: 'inFakt' }).catch(() => {});
    }
    await page.screenshot({ path: OUT + '/AE-before-save.png' });
    const saveBtn = page.getByRole('button', { name: 'Save rule' });
    const saveDisabled = await saveBtn.isDisabled();
    console.log('save disabled:', saveDisabled);
    if (!saveDisabled) {
      await saveBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: OUT + '/AF-after-save.png', fullPage: true });
    }
  } finally {
    await browser.close();
  }
})();
