/**
 * Invoicing: `/invoices` list page — buyer tax ID column + filter (#3188)
 *
 * No prior e2e spec ever visits `/invoices` at all: every existing
 * invoicing spec drives the API directly (`api.invoices.*`). #3188 added a
 * `buyerTaxId` column (rendered via the shared `OrderBuyerTaxIdValue`, #3180)
 * and a `taxId=with|without` filter select to the list page, and neither had
 * ever been exercised through a browser.
 *
 * Three seeded invoices, one per `OrderBuyerTaxIdValue` rendering (#3180's
 * three-state encoding): a real tax id frozen at issue, an order the source
 * never asserted one for, and an order whose source positively asserted "no
 * tax id". Scoped to the seed's OWN connection via the connection filter so
 * the assertions are independent of how many other invoices already exist on
 * the stack and of the list's `createdAt DESC` ordering (the seed's three
 * inserts share one transaction, so their `createdAt` values are not
 * guaranteed to be distinct).
 *
 * @module tests/invoicing
 */
import { test, expect } from '../../src/fixtures/test';
import {
  seedInvoicesListFixture,
  INVOICES_LIST_SEED_BUYER_TAX_ID,
} from '../../src/support/invoices-list-seed';

const SEED_CONNECTION_LABEL = 'Ksef Invoices-list (M10 seed)';

test.describe('invoicing: /invoices list — buyer tax ID', () => {
  test.beforeAll(async () => {
    await seedInvoicesListFixture();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/invoices');
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible({ timeout: 30_000 });
    await page
      .getByLabel('Filter by connection')
      .selectOption({ label: SEED_CONNECTION_LABEL });
    // Scoping to the seed connection narrows to exactly the 3 fixture rows —
    // this table load settling is the wait for that filter to take effect.
    await expect(page.getByRole('row', { name: /M10\/SEED\/0003/ })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('renders the correct tax-id state per row', async ({ page }) => {
    const withTaxIdRow = page.getByRole('row', { name: /M10\/SEED\/0001/ });
    await expect(withTaxIdRow.getByTestId('order-buyer-tax-id')).toHaveText(
      INVOICES_LIST_SEED_BUYER_TAX_ID,
    );

    const unassertedRow = page.getByRole('row', { name: /M10\/SEED\/0002/ });
    await expect(unassertedRow.getByTestId('order-buyer-tax-id-unknown')).toBeVisible();

    const noneAssertedRow = page.getByRole('row', { name: /M10\/SEED\/0003/ });
    await expect(noneAssertedRow.getByTestId('order-buyer-tax-id-none')).toBeVisible();
  });

  test('the taxId=with|without filter partitions the seeded rows correctly', async ({ page }) => {
    await page.getByLabel('Filter by buyer tax ID').selectOption({ label: 'With tax ID' });
    await expect(page).toHaveURL(/taxId=with/);
    await expect(page.getByRole('row', { name: /M10\/SEED\/0001/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /M10\/SEED\/0002/ })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /M10\/SEED\/0003/ })).toHaveCount(0);

    await page.getByLabel('Filter by buyer tax ID').selectOption({ label: 'Without tax ID' });
    await expect(page).toHaveURL(/taxId=without/);
    await expect(page.getByRole('row', { name: /M10\/SEED\/0001/ })).toHaveCount(0);
    // Both "not asserted" (0002) and "asserted-none" (0003) collapse into
    // `hasBuyerTaxId = false`, i.e. the "without" side of the filter (#1202)
    // — the filter is a presence test, distinct from the three-state VALUE
    // the column itself renders.
    await expect(page.getByRole('row', { name: /M10\/SEED\/0002/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /M10\/SEED\/0003/ })).toBeVisible();

    await page.getByLabel('Filter by buyer tax ID').selectOption({ label: 'All buyer tax IDs' });
    await expect(page).not.toHaveURL(/taxId=/);
    await expect(page.getByRole('row', { name: /M10\/SEED\/0001/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /M10\/SEED\/0002/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /M10\/SEED\/0003/ })).toBeVisible();
  });
});
