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

    // A2: try to search+select an ALREADY-listed country (PL) in the picker.
    await page.getByRole('combobox', { name: 'New market country' }).click();
    await page.getByPlaceholder(/Type to search/i).fill('Poland');
    await page.waitForTimeout(600);
    const plOption = page.getByText('Poland', { exact: true });
    const isDisabled = await plOption.locator('..').getAttribute('aria-disabled').catch(() => 'n/a');
    console.log('Poland option aria-disabled:', isDisabled);
    await page.screenshot({ path: OUT + '/AN-poland-disabled-check.png' });

    // Close picker, then check A6's "Reset country" exact copy on DE (has a real rule).
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const btns = await page.$$('button:has-text("Configure")');
    await btns[0].click(); // DE
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Reset country' }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + '/AO-de-reset-confirm.png' });
  } finally {
    await browser.close();
  }
})();
