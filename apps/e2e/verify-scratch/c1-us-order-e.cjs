const { chromium } = require('playwright');
const PS_BASE = 'http://localhost:18080/admin-dev';
const OUT = __dirname + '/screenshots';

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ storageState: OUT + '/../ps-admin-state.json', viewport: { width: 1700, height: 2200 } });
    const page = await context.newPage();
    await page.goto(PS_BASE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    const token = new URL(page.url()).searchParams.get('token');
    await page.goto(PS_BASE + `/index.php/sell/orders/new?token=${token}`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1200);

    const searchInput = page.locator('label:has-text("Search for a customer")').locator('xpath=following::input[1]');
    await searchInput.fill('Firma');
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Choose' }).click();
    await page.waitForTimeout(1500);

    const productSearch = page.locator('label:has-text("Search for a product")').locator('xpath=following::input[1]');
    await productSearch.fill('Canon');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await page.waitForTimeout(2000);

    await page.locator('text=Add new address').first().click();
    await page.waitForTimeout(2000);

    await page.locator('label:has-text("Address alias")').locator('xpath=following::input[1]').fill('US test address');
    await page.locator('label:has-text("Address")').first().locator('xpath=following::input[1]').fill('123 Main St');
    await page.locator('label:has-text("Zip/Postal code")').locator('xpath=following::input[1]').fill('10001');
    await page.locator('label:has-text("City")').locator('xpath=following::input[1]').fill('New York');
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + '/C1-address-filled.png', fullPage: true });

    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: OUT + '/C1-address-saved.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
