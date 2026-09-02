const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';
const ORDER = 'ol_order_d5fee0999de24cb891057c3ffc2cc6bf';

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(BASE + '/login', { waitUntil: 'load', timeout: 20000 });
    const userField = await page.$('input[name="username"]');
    if (userField) await userField.fill('admin');
    await page.fill('input[type="password"]', 'admin');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1200);

    await page.goto(BASE + '/orders/' + ORDER, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1200);
    const disc = page.locator('text=Issue or register manually instead');
    if (await disc.isVisible().catch(() => false)) {
      await disc.click();
      await page.waitForTimeout(500);
    }
    const issueBtn = page.getByRole('button', { name: 'Issue invoice' });
    const disabled = await issueBtn.getAttribute('disabled');
    console.log('disabled attr:', disabled);
    const html = await issueBtn.evaluate((el) => el.outerHTML);
    console.log('outerHTML:', html);
    const parent = await issueBtn.evaluate((el) => el.closest('.sales-document-panel__override-card-action')?.outerHTML ?? 'NOT FOUND');
    console.log('parent HTML:', parent);
  } finally {
    await browser.close();
  }
})();
