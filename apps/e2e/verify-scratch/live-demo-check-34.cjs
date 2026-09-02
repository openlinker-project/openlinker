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
    const btns = await page.$$('button:has-text("Configure")');
    await btns[1].click(); // PL
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.waitForTimeout(500);

    const docTypeSelect = page.locator('#sd-rule-doctype');
    const connSelect = page.locator('#sd-rule-connection');

    await docTypeSelect.selectOption({ label: 'Invoice' });
    await page.waitForTimeout(300);
    const invoiceOpts = await connSelect.locator('option').allTextContents();
    console.log('Invoice -> connection options:', invoiceOpts);

    await docTypeSelect.selectOption({ label: 'Receipt' }).catch(async () => {
      const opts = await docTypeSelect.locator('option').allTextContents();
      console.log('doctype options available:', opts);
    });
    await page.waitForTimeout(300);
    const receiptOpts = await connSelect.locator('option').allTextContents();
    console.log('Receipt -> connection options:', receiptOpts);
  } finally {
    await browser.close();
  }
})();
