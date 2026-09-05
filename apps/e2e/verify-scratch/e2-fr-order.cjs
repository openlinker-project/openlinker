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
    await page.waitForTimeout(2500);

    const frame = page.frames().find(f => f.url().includes('addresses/new'));
    await frame.locator('#customer_address_alias').fill('FR test address');
    await frame.locator('#customer_address_address1').fill('10 Rue de Paris');
    await frame.locator('#customer_address_postcode').fill('75001');
    await frame.locator('#customer_address_city').fill('Paris');
    await frame.locator('#customer_address_id_country').selectOption({ label: 'France' }).catch(async () => {
      const sel = frame.locator('select[name*="id_country"]');
      await sel.selectOption({ label: 'France' });
    });
    await page.waitForTimeout(500);
    await frame.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(3000);

    const deliverySelect = page.locator('#delivery-address-select');
    await deliverySelect.selectOption({ label: 'FR test address' });
    const invoiceSelect = page.locator('#invoice-address-select');
    await invoiceSelect.selectOption({ label: 'FR test address' }).catch(() => {});
    await page.waitForTimeout(1000);
    await page.screenshot({ path: OUT + '/E2-fr-address-selected.png', fullPage: true });

    const paymentSelect = page.locator('label:has-text("Payment")').locator('xpath=following::select[1]');
    await paymentSelect.selectOption({ label: 'Bank transfer' });
    const statusSelect = page.locator('label:has-text("Order status")').locator('xpath=following::select[1]');
    await statusSelect.selectOption({ label: 'Payment accepted' });
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: 'Create order' }).click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: OUT + '/E2-fr-order-created.png', fullPage: true });
    console.log('final url:', page.url());
  } finally {
    await browser.close();
  }
})();
