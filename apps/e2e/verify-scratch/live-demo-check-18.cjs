const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const ORDER = 'ol_order_d5fee0999de24cb891057c3ffc2cc6bf';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 20000 });
  const userField = await page.$('input[name="username"]');
  if (userField) await userField.fill('admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  await page.goto(BASE + '/orders/' + ORDER, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1200);
  const disc = page.locator('text=Issue or register manually instead'); if (await disc.isVisible().catch(()=>false)) { await disc.click(); }
  await page.waitForTimeout(600);

  const select = page.locator('select').filter({ hasText: 'Invoice (faktura)' }).first();
  const isDisabled = await select.isDisabled().catch(() => 'n/a');
  const issueBtn = page.getByRole('button', { name: 'Issue invoice' });
  const btnDisabled = await issueBtn.isDisabled().catch(() => 'n/a');
  const cardText = await page.locator('.sales-document-panel__override-card').first().textContent();
  console.log(JSON.stringify({ selectDisabled: isDisabled, btnDisabled, cardText }, null, 2));

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
