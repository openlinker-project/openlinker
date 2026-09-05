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

    await page.getByRole('combobox', { name: 'New market country' }).click();
    await page.getByPlaceholder(/Type to search/i).fill('Poland');
    await page.waitForTimeout(600);
    await page.getByText('Poland', { exact: true }).click();
    await page.waitForTimeout(500);
    const addBtn = page.getByRole('button', { name: 'Add a market' });
    const addDisabled = await addBtn.isDisabled();
    console.log('Add a market disabled after picking existing PL:', addDisabled);
    await addBtn.click({ force: addDisabled }).catch(e => console.log('click error:', e.message));
    await page.waitForTimeout(800);
    await page.screenshot({ path: OUT + '/AP-after-pick-existing-pl.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
