const { chromium } = require('playwright');

const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

  // Login
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[name="email"], input[type="email"]', 'admin@openlinker.local').catch(() => {});
  const userField = await page.$('input[name="username"]');
  if (userField) await userField.fill('admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: OUT + '/00-after-login.png', fullPage: true });

  // A: Settings sales-documents unified market list
  await page.goto(BASE + '/settings/sales-documents', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + '/A-settings-sales-documents.png', fullPage: true });

  // Confirm "Connected providers" page is gone (404 or redirect)
  await page.goto(BASE + '/settings/sales-documents/providers', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/A2-providers-page-retired.png', fullPage: true });
  const providersUrl = page.url();

  // Connections list
  await page.goto(BASE + '/connections', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + '/B-connections-list.png', fullPage: true });
  const connectionRows = await page.$$eval('table tbody tr, [data-testid="connection-row"]', (els) => els.length).catch(() => 0);

  // Orders list
  await page.goto(BASE + '/orders', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + '/C-orders-list.png', fullPage: true });

  await browser.close();

  console.log(JSON.stringify({ providersUrl, connectionRows, consoleErrorCount: consoleErrors.length, consoleErrors: consoleErrors.slice(0, 20) }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
