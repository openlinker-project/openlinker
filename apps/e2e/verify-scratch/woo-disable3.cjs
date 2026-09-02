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
    await page.goto(BASE + '/connections/ddb3072f-0b22-4906-8e9e-0cc626689744', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.getByRole('tab', { name: 'Actions' }).click().catch(async () => { await page.getByText('Actions', {exact:true}).click(); });
    await page.waitForTimeout(800);
    await page.screenshot({ path: OUT + '/WC4-actions-tab.png', fullPage: true });
    const disableBtn = page.getByRole('button', { name: /Disable/i });
    if (await disableBtn.count() > 0) {
      await disableBtn.click();
      await page.waitForTimeout(500);
      const confirm = page.getByRole('button', { name: /Yes|Confirm|Disable/i }).last();
      if (await confirm.count() > 0) await confirm.click();
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: OUT + '/WC5-after-disable.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
