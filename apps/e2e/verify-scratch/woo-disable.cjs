const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
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
    await page.goto(BASE + '/connections/ddb3072f-0b22-4906-8e9e-0cc626689744', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1000);
    const disableBtn = page.getByRole('button', { name: 'Disable connection' });
    if (await disableBtn.count() > 0) { await disableBtn.click(); await page.waitForTimeout(800); }
  } finally {
    await browser.close();
  }
})();
