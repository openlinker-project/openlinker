/**
 * Sales documents: a connection may issue both document kinds (#3195)
 *
 * `documentKind: 'both'` is a connection-role config sentinel: a connection
 * with BOTH `Invoicing` and `Fiscalization` enabled may be told it issues
 * either kind ("Both"), and once it is, it must appear in a country's "If no
 * rule matched" fallback picker TWICE — once per concrete kind, since a
 * routing decision always names exactly one — sharing one `connectionId`
 * under a `{connectionId}:{documentKind}` composite option value
 * (`candidateOptionValue`, `sales-document-country-defaults.tsx`).
 *
 * Before this spec only the capability FLAG (`enabledCapabilities` including
 * both names) had any coverage — nothing drove the actual "Both" option in
 * the "Issues" select, and nothing asserted the resulting double-listing in
 * the country-default picker.
 *
 * FIXTURE: `seedDualRoleConnection` (`dual-role-connection-seed.ts`) writes
 * ONE connection with both capabilities enabled and NO role set yet — this
 * spec's own first test is what drives the role through the UI. Reuses
 * `seedSalesDocumentMarketOrders`'s FI market (unconfigured, always
 * detected) as the country whose fallback picker is checked.
 *
 * `workers: 1` / `fullyParallel: false` (`playwright.config.ts`) is what lets
 * the second test rely on the FIRST test having already set the role through
 * the UI — this file's tests run in declaration order, on one worker.
 *
 * @module tests/sales-documents
 */
import { test, expect } from '../../src/fixtures/test';
import {
  seedSalesDocumentMarketOrders,
  MARKET_SEED_COUNTRIES,
} from '../../src/support/sales-document-market-seed';
import {
  seedDualRoleConnection,
  DUAL_ROLE_CONNECTION_ID,
  DUAL_ROLE_CONNECTION_NAME,
} from '../../src/support/dual-role-connection-seed';

const COUNTRY = MARKET_SEED_COUNTRIES.unconfigured; // 'FI'

test.describe('sales documents: dual-role connection ("Both")', () => {
  test.beforeAll(async () => {
    await seedSalesDocumentMarketOrders();
    await seedDualRoleConnection();
  });

  test('a connection with both capabilities offers, and persists, "Both" in the Issues select', async ({
    page,
  }) => {
    await page.goto('/settings/sales-documents');
    await expect(page.getByRole('heading', { name: 'Sales documents' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { name: 'Connected providers' })).toBeVisible();

    const row = page
      .getByRole('table', { name: 'Sales-document routing per connection' })
      .locator('tbody tr')
      .filter({ hasText: DUAL_ROLE_CONNECTION_NAME });
    await expect(row).toBeVisible();

    const issuesSelect = row.getByLabel(`Document ${DUAL_ROLE_CONNECTION_NAME} issues`);
    const optionValues = await issuesSelect.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value),
    );
    // The dual-role vocabulary (#3195) - never the single-capability set a
    // plain Invoicing- or Fiscalization-only connection would offer.
    expect(optionValues.sort()).toEqual(['', 'both', 'fiscal-receipt', 'invoice'].sort());

    await issuesSelect.selectOption('both');
    await expect(issuesSelect).toHaveValue('both');

    // Persisted, not merely local React state - reload and re-read.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Connected providers' })).toBeVisible();
    const reloadedRow = page
      .getByRole('table', { name: 'Sales-document routing per connection' })
      .locator('tbody tr')
      .filter({ hasText: DUAL_ROLE_CONNECTION_NAME });
    await expect(
      reloadedRow.getByLabel(`Document ${DUAL_ROLE_CONNECTION_NAME} issues`),
    ).toHaveValue('both');
  });

  test('a "Both" connection appears TWICE in a country\'s fallback picker, once per concrete kind', async ({
    page,
  }) => {
    await page.goto('/settings/sales-documents');
    await expect(page.getByRole('heading', { name: 'Sales documents' })).toBeVisible({
      timeout: 30_000,
    });

    const row = page
      .locator('.sales-document-market-row')
      .filter({ has: page.locator('.sales-document-market-row__name', { hasText: COUNTRY }) });
    await row.getByRole('button', { name: /Configure/ }).click();
    await expect(
      page.getByRole('heading', { name: `Sales-document routing · ${COUNTRY}` }),
    ).toBeVisible();

    const picker = page.getByTestId('country-default');
    await expect(picker).toBeVisible();

    const optionTexts = await picker.locator('option').allTextContents();
    expect(optionTexts).toContain(`Invoice · ${DUAL_ROLE_CONNECTION_NAME}`);
    expect(optionTexts).toContain(`Receipt · ${DUAL_ROLE_CONNECTION_NAME}`);

    // Two distinct option VALUES sharing one connection id — the composite
    // `{connectionId}:{documentKind}` key, never the same value twice.
    const values = await picker.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value),
    );
    const dualRoleValues = values.filter((v) => v.startsWith(`${DUAL_ROLE_CONNECTION_ID}:`));
    expect(dualRoleValues.sort()).toEqual(
      [`${DUAL_ROLE_CONNECTION_ID}:invoice`, `${DUAL_ROLE_CONNECTION_ID}:fiscal-receipt`].sort(),
    );
  });
});
