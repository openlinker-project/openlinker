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

    // Spain should already exist as a market row now from the previous run
    const esRow = page.locator('.sales-document-market-row').filter({ has: page.locator('.sales-document-market-row__name', { hasText: /^ES$/ }) });
    if (await esRow.count() === 0) {
      console.log('ES row not found - previous add-market may not have persisted');
      await page.screenshot({ path: OUT + '/AC-no-es-row.png', fullPage: true });
      return;
    }
    await esRow.getByRole('button', { name: /Configure/ }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.waitForTimeout(500);

    const addConditionBtn = page.getByRole('button', { name: '+ Add condition' });
    await addConditionBtn.click();
    await page.waitForTimeout(300);
    await addConditionBtn.click();
    await page.waitForTimeout(300);

    const fieldSelects = await page.locator('.dialog__content--elevated .rule-composer-condition-row select').all();
    // fieldSelects alternate field/value per row; pick the 2nd row's field select (index 2) -> Order country
    await fieldSelects[2].selectOption({ label: 'Order country is' });
    await page.waitForTimeout(300);
    await fieldSelects[4].selectOption({ label: 'Order total (gross)' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: OUT + '/AD-distinct-condition-shapes.png' });

    // Now report what input type row 2 and row 3 use
    const rows = await page.locator('.rule-composer-condition-row').all();
    for (let i = 0; i < rows.length; i++) {
      const html = await rows[i].innerHTML();
      console.log('--- row', i, '---');
      console.log(html.replace(/\s+/g, ' ').slice(0, 400));
    }
  } finally {
    await browser.close();
  }
})();
