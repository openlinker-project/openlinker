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
    await page.screenshot({ path: OUT + '/PSA10-tier1-cart-tax-fixed.png', fullPage: true });

    const paymentSelect = page.locator('label:has-text("Payment")').locator('xpath=following::select[1]');
    await paymentSelect.selectOption({ label: 'Bank transfer' });

    const statusSelect = page.locator('label:has-text("Order status")').locator('xpath=following::select[1]');
    await statusSelect.selectOption({ label: 'Payment accepted' });
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: 'Create order' }).click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: OUT + '/PSA11-tier1-created-final.png', fullPage: true });
    console.log('final url:', page.url());
  } finally {
    await browser.close();
  }
})();
