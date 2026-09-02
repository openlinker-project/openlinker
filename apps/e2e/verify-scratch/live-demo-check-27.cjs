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

    // Add a market: ES (Spain) - throwaway test country
    await page.getByRole('combobox', { name: 'New market country' }).click();
    await page.getByPlaceholder(/Type to search/i).fill('Spain');
    await page.waitForTimeout(600);
    await page.getByText('Spain', { exact: true }).click();
    await page.getByRole('button', { name: 'Add a market' }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: OUT + '/AA-es-dialog-opened.png' });

    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.waitForTimeout(500);

    // B4: add orderCountry + orderTotalGross conditions alongside buyerHasTaxId
    const addConditionBtn = page.getByRole('button', { name: '+ Add condition' });
    await addConditionBtn.click();
    await page.waitForTimeout(300);
    await addConditionBtn.click();
    await page.waitForTimeout(300);

    const fieldSelects = page.locator('.dialog__content--elevated select').filter({ hasText: '' });
    await page.screenshot({ path: OUT + '/AB-three-conditions.png' });

    const allSelects = await page.locator('.dialog__content--elevated select').all();
    console.log('total selects in modal:', allSelects.length);
    for (let i = 0; i < allSelects.length; i++) {
      const opts = await allSelects[i].locator('option').allTextContents();
      console.log(i, opts.slice(0, 6));
    }
  } finally {
    await browser.close();
  }
})();
