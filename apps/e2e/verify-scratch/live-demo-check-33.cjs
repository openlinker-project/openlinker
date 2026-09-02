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
    await page.screenshot({ path: OUT + '/AJ-es-acknowledged-state.png' });

    const undoBtn = page.getByRole('button', { name: /Undo/i });
    console.log('undo count:', await undoBtn.count());
    if (await undoBtn.count() > 0) {
      await undoBtn.click();
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: OUT + '/AK-es-after-undo.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
