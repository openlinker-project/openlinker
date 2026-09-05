const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';
const ORDER = 'ol_order_d5fee0999de24cb891057c3ffc2cc6bf';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 20000 });
  const userField = await page.$('input[name="username"]');
  if (userField) await userField.fill('admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  await page.goto(BASE + '/orders/' + ORDER, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + '/Q-before-issue-invoice.png', fullPage: true });

  const disclosure = page.locator('text=Issue or register manually instead');
  if (await disclosure.count() > 0) {
    await disclosure.click();
    await page.waitForTimeout(600);
    const issueBtn = page.getByRole('button', { name: 'Issue invoice' });
    if (await issueBtn.count() > 0) {
      await issueBtn.click();
      await page.waitForTimeout(4000);
      await page.screenshot({ path: OUT + '/R-after-issue-invoice.png', fullPage: true });
    } else {
      console.log('NO Issue invoice button found');
    }
  } else {
    console.log('NO disclosure found - order state:', await page.locator('.sales-document-panel, [class*="sales-document"]').first().textContent().catch(()=>'n/a'));
  }
  console.log(JSON.stringify({ errors }, null, 2));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
