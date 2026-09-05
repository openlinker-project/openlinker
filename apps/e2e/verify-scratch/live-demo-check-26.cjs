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

    await page.locator('text=★ Rest of world').first().locator('xpath=ancestor::li[1]').getByRole('button', { name: 'Configure' }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: OUT + '/Z-rest-of-world-dialog.png', fullPage: true });

    const tierNumbers = await page.locator('.sales-document-tier__number, [class*="tier"][class*="number"]').allTextContents();
    console.log('tier count via class:', tierNumbers.length, tierNumbers);
  } finally {
    await browser.close();
  }
})();
