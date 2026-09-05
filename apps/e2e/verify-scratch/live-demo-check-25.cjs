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

    const chips = ['All markets', 'Recent orders', 'Configured, no recent orders', 'Needs a decision'];
    const results = {};
    for (const chip of chips) {
      const btn = page.getByRole('button', { name: new RegExp('^' + chip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
      await btn.click();
      await page.waitForTimeout(500);
      const rows = await page.locator('.sales-document-market-row').allTextContents();
      results[chip] = rows.map(r => r.split('\n')[0]?.trim() ?? r.trim().slice(0,20));
    }
    console.log(JSON.stringify(results, null, 2));
    await page.screenshot({ path: OUT + '/Y-filter-chips-final.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
