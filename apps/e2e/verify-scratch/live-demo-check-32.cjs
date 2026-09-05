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

    const esRow = page.locator('.sales-document-market-row').filter({ has: page.locator('.sales-document-market-row__name', { hasText: /^ES$/ }) });
    await esRow.getByRole('button', { name: /Configure/ }).click();
    await page.waitForTimeout(800);

    const resetBtn = page.getByRole('button', { name: 'Reset country' });
    await resetBtn.click();
    await page.waitForTimeout(500);
    const confirmBtn = page.getByRole('button', { name: 'Yes, reset' });
    await confirmBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: OUT + '/AI-es-reset.png', fullPage: true });

    // Close the now-empty dialog via the close-time gate.
    const doneBtn = page.getByRole('button', { name: 'Done' });
    await doneBtn.click();
    await page.waitForTimeout(400);
    const confirmClose = page.getByRole('button', { name: 'Confirm - nothing needed here' });
    if (await confirmClose.count() > 0) {
      await confirmClose.click();
    }
    await page.waitForTimeout(800);

    const rows = await page.locator('.sales-document-market-row').allTextContents();
    console.log('rows after cleanup:', rows.map(r => r.split('\n')[0]));
  } finally {
    await browser.close();
  }
})();
