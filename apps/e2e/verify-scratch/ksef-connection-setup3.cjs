const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1300 } });
    await page.goto(BASE + '/login', { waitUntil: 'load', timeout: 20000 });
    const userField = await page.$('input[name="username"]');
    if (userField) await userField.fill('admin');
    await page.fill('input[type="password"]', 'admin');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);

    await page.goto(BASE + '/connections/new', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1000);
    const card = page.locator(':has-text("Krajowy System e-Faktur")').last();
    await card.locator('..').getByRole('link', { name: /Continue/ }).click();
    await page.waitForTimeout(1200);
    console.log('URL:', page.url());
    await page.screenshot({ path: OUT + '/KS2-ksef-wizard-step1.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
