const path = require('node:path');
const pw = require('/tmp/epic2452/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const { chromium } = pw;

const BASE = 'http://localhost:18090';
const SHOT_DIR = path.join(__dirname, 'screenshots');

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder(/username or email/i).fill('admin');
  await page.getByPlaceholder(/enter your password/i).fill('admin');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(1500);
}

async function goto(page, path) {
  await page.evaluate((p) => {
    history.pushState({}, '', p);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForTimeout(1200);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await login(page);

  await goto(page, '/settings/sales-documents');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOT_DIR, 'live-01-settings-page.png'), fullPage: true });

  // Open PL's routing dialog specifically (has the starter template)
  const plRow = page.locator('li', { hasText: 'PL' }).first();
  const configureBtn = plRow.getByRole('button', { name: /^Configure$/ });
  if ((await configureBtn.count()) > 0) {
    await configureBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOT_DIR, 'live-02-routing-dialog-pl.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  } else {
    console.log('NO CONFIGURE BUTTON FOUND for PL');
  }

  // Providers page
  await goto(page, '/settings/sales-documents/providers');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOT_DIR, 'live-03-providers-page.png'), fullPage: true });

  await context.close();
  await browser.close();
  console.log('DONE');
}
main().catch((e) => { console.error(e); process.exit(1); });
