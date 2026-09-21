/**
 * Sales documents: "Test with a sample order" dry-run (#3191)
 *
 * `SalesDocumentRuleComposerDialog`'s dry-run panel (#3191) lets an operator
 * test an IN-PROGRESS, unsaved rule candidate against a hand-typed sample
 * order before clicking Save. It had zero e2e coverage: the FE/BE unit specs
 * cover the mapping and the pure projection, but nothing had ever driven the
 * real toggle, the real live `POST /sales-documents/rules/dry-run` round
 * trip, or the feature's own core acceptance criterion — that running it
 * PERSISTS NOTHING.
 *
 * MARKET: reuses `seedSalesDocumentMarketOrders` (`sales-document-market-seed.ts`,
 * the `rule-composer-redesign.spec.ts` fixture) and its `unconfigured` country
 * (FI) — guaranteed a detected order and no persisted rule/default/
 * acknowledgment for the duration of this file's run, matching the sibling
 * spec's own seeding rationale.
 *
 * OUTCOME DETERMINISM: four of the `evaluateSalesDocumentRules` outcome
 * families are exercised, each reached by a candidate condition whose
 * evaluation cannot be perturbed by whatever ELSE a shared dev stack happens
 * to hold for FI:
 *   - `orderCountry eq FI` against a sample order in FI ALWAYS matches the
 *     candidate (tier 1), so `route`/`matchedByCandidateRule: true` is
 *     reachable regardless of stack history.
 *   - `orderTotalGross gte …` against a sample order EXPLICITLY marked
 *     net-priced (the panel's "Sample order pricing" select, previously
 *     absent — an operator testing a PL-style threshold rule against the
 *     panel's default could never get anything but this refusal, since there
 *     was no way to assert the order was gross-priced at all) ALWAYS
 *     resolves `net-priced-order`: `evaluateSalesDocumentRules` refuses to
 *     compare an amount on an order it cannot confirm is gross-priced. That
 *     refusal fires before any other rule in the scope is even consulted for
 *     THIS candidate, independent of what else FI carries.
 *   - the SAME `orderTotalGross gte …` condition against a sample order left
 *     on the panel's default ("Gross-priced") now genuinely matches, closing
 *     the gap the previous bullet's old, unconditional wording described —
 *     the flagship PL amount-threshold rule shape is testable here.
 *   - a country default set via the real write API (`PUT
 *     .../country-defaults`, not a persisted RULE — the composer's own
 *     candidate is deliberately built to miss, via `orderCountry eq 'ZZ'`, so
 *     the tier-2 fallback is what answers) reaches `route`/
 *     `matchedByCandidateRule: false` — "via an already-saved rule" — without
 *     needing an exact-match rival rule to already exist on the shared stack.
 *
 * @module tests/sales-documents
 */
import { test, expect } from '../../src/fixtures/test';
import type { Page } from '@playwright/test';
import {
  seedSalesDocumentMarketOrders,
  MARKET_SEED_CONNECTION_IDS,
  MARKET_SEED_COUNTRIES,
} from '../../src/support/sales-document-market-seed';

const COUNTRY = MARKET_SEED_COUNTRIES.unconfigured; // 'FI' — always detected, never configured.

async function openComposerFor(page: Page, country: string): Promise<void> {
  await page.goto('/settings/sales-documents');
  await expect(page.getByRole('heading', { name: 'Sales documents' })).toBeVisible({
    timeout: 30_000,
  });
  const row = page
    .locator('.sales-document-market-row')
    .filter({ has: page.locator('.sales-document-market-row__name', { hasText: country }) });
  await row.getByRole('button', { name: /Configure/ }).click();
  await expect(
    page.getByRole('heading', { name: `Sales-document routing · ${country}` }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await expect(page.locator('.dialog__content--elevated')).toBeVisible();
}

test.describe('sales documents: rule composer dry-run ("Test with a sample order")', () => {
  test.beforeAll(async () => {
    await seedSalesDocumentMarketOrders();
  });

  test('toggles the sample-order panel open and closed', async ({ page }) => {
    await openComposerFor(page, COUNTRY);
    const modal = page.locator('.dialog__content--elevated');
    const toggle = modal.getByTestId('rule-test-sample-order');
    const panel = modal.getByTestId('rule-test-sample-order-panel');

    await expect(panel).not.toBeVisible();
    await toggle.click();
    await expect(panel).toBeVisible();
    await toggle.click();
    await expect(panel).not.toBeVisible();
  });

  test('the run button stays disabled until a connection and every sample field are filled', async ({
    page,
  }) => {
    await openComposerFor(page, COUNTRY);
    const modal = page.locator('.dialog__content--elevated');
    await modal.getByTestId('rule-test-sample-order').click();

    const runButton = modal.getByTestId('rule-run-sample-order-test');
    // Nothing filled yet — no connection, no sample fields.
    await expect(runButton).toBeDisabled();

    await modal.getByLabel('Sample order delivery country').fill(COUNTRY);
    await expect(runButton).toBeDisabled();
    await modal.getByLabel('Sample order total amount').fill('42');
    await expect(runButton).toBeDisabled();
    await modal.getByLabel('Sample order currency').fill('EUR');
    // Every sample field is filled, but the Integration select is still
    // unset — the run button's own `connectionId === ''` guard.
    await expect(runButton).toBeDisabled();

    await modal
      .getByLabel('Integration')
      .selectOption({ value: MARKET_SEED_CONNECTION_IDS.invoicing });
    await expect(runButton).toBeEnabled();
  });

  test('reports "net-priced-order" from a live round trip when the sample order is explicitly net-priced', async ({
    page,
  }) => {
    await openComposerFor(page, COUNTRY);
    const modal = page.locator('.dialog__content--elevated');

    // The one pre-existing condition row, changed to an amount condition.
    await modal.getByLabel('Condition field').selectOption({ value: 'orderTotalGross' });
    await modal.getByLabel('Order total amount').fill('10.00');
    await modal.getByLabel('Order total currency').fill('EUR');

    await modal
      .getByLabel('Integration')
      .selectOption({ value: MARKET_SEED_CONNECTION_IDS.invoicing });

    await modal.getByTestId('rule-test-sample-order').click();
    await modal.getByLabel('Sample order delivery country').fill(COUNTRY);
    await modal.getByLabel('Sample order total amount').fill('100');
    await modal.getByLabel('Sample order currency').fill('EUR');
    // Explicitly net-priced — the refusal branch this test targets. The
    // panel defaults to gross-priced, which the next test exercises instead.
    await modal.getByLabel('Sample order pricing').selectOption({ value: 'exclusive' });

    await modal.getByTestId('rule-run-sample-order-test').click();

    const result = modal.getByTestId('rule-test-sample-order-result');
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result).toContainText(/priced net|held/i);
    await expect(modal.getByTestId('rule-test-sample-order-error')).not.toBeVisible();
  });

  test('matches an amount-threshold condition against a gross-priced sample order (default pricing)', async ({
    page,
  }) => {
    await openComposerFor(page, COUNTRY);
    const modal = page.locator('.dialog__content--elevated');

    // Same shape as the PL flagship template: "total >= X -> invoice".
    await modal.getByLabel('Condition field').selectOption({ value: 'orderTotalGross' });
    await modal.getByLabel('Order total comparison').selectOption({ value: 'gte' });
    await modal.getByLabel('Order total amount').fill('10.00');
    await modal.getByLabel('Order total currency').fill('EUR');

    await modal
      .getByLabel('Integration')
      .selectOption({ value: MARKET_SEED_CONNECTION_IDS.invoicing });

    await modal.getByTestId('rule-test-sample-order').click();
    await modal.getByLabel('Sample order delivery country').fill(COUNTRY);
    await modal.getByLabel('Sample order total amount').fill('100');
    await modal.getByLabel('Sample order currency').fill('EUR');
    // Pricing left on the panel's default ("Gross-priced") — no interaction.
    await expect(modal.getByLabel('Sample order pricing')).toHaveValue('inclusive');

    await modal.getByTestId('rule-run-sample-order-test').click();

    const result = modal.getByTestId('rule-test-sample-order-result');
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result).toContainText('via the rule you are drafting');
    await expect(result).not.toContainText(/priced net/i);
    await expect(modal.getByTestId('rule-test-sample-order-error')).not.toBeVisible();
  });

  test('reports a "route" decision matched by the DRAFT candidate, and persists nothing for the market', async ({
    page,
    api,
  }) => {
    // #3191's own acceptance criterion: running the dry run must not change
    // what `GET /sales-documents/markets` reports for this country — no rule,
    // no default. Read it before, and again after, around the one dry run
    // that actually reaches a `route` decision in this file.
    const before = await api.salesDocuments.markets();
    const fiBefore = before.markets.find((m) => m.country === COUNTRY);

    await openComposerFor(page, COUNTRY);
    const modal = page.locator('.dialog__content--elevated');

    // Matches the sample order unconditionally (tier 1) once the sample
    // country is the same FI — nothing rival needs to be absent for this to
    // resolve, because the candidate rule itself is guaranteed to match.
    await modal.getByLabel('Condition field').selectOption({ value: 'orderCountry' });
    await modal.getByLabel('Order country value').fill(COUNTRY);

    await modal
      .getByLabel('Integration')
      .selectOption({ value: MARKET_SEED_CONNECTION_IDS.invoicing });

    await modal.getByTestId('rule-test-sample-order').click();
    await modal.getByLabel('Sample order delivery country').fill(COUNTRY);
    await modal.getByLabel('Sample order total amount').fill('42');
    await modal.getByLabel('Sample order currency').fill('EUR');

    await modal.getByTestId('rule-run-sample-order-test').click();

    const result = modal.getByTestId('rule-test-sample-order-result');
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result).toContainText('via the rule you are drafting');
    await expect(result).toContainText('an invoice');
    await expect(modal.getByTestId('rule-test-sample-order-error')).not.toBeVisible();

    // Nothing was saved: no `sales_document_rules` row and no country
    // default were created by the dry run itself.
    const after = await api.salesDocuments.markets();
    const fiAfter = after.markets.find((m) => m.country === COUNTRY);
    expect(fiAfter?.ruleCount ?? 0).toBe(fiBefore?.ruleCount ?? 0);
    expect(fiAfter?.invoiceDefaultConnectionId ?? null).toBe(
      fiBefore?.invoiceDefaultConnectionId ?? null,
    );
    expect(fiAfter?.receiptDefaultConnectionId ?? null).toBe(
      fiBefore?.receiptDefaultConnectionId ?? null,
    );
  });

  test('reports a "route" decision matched by an ALREADY-SAVED routing config, not the draft', async ({
    page,
    api,
  }) => {
    // A country default (tier 2) — the ordinary, cheap, always-available
    // write path this package's own seeds use to reach "already configured"
    // (`sales-document-market-seed.ts`'s own doc comment) — set up as the
    // pre-existing configuration the DRAFT is deliberately built to miss.
    const countryDefault = await api.salesDocuments.upsertCountryDefault({
      country: COUNTRY,
      documentKind: 'invoice',
      connectionId: MARKET_SEED_CONNECTION_IDS.invoicing,
    });

    try {
      await openComposerFor(page, COUNTRY);
      const modal = page.locator('.dialog__content--elevated');

      // A country value that can never equal the sample order's own country
      // — the draft candidate is guaranteed to miss, so only the pre-existing
      // default (tier 2) can answer.
      await modal.getByLabel('Condition field').selectOption({ value: 'orderCountry' });
      await modal.getByLabel('Order country value').fill('ZZ');

      await modal
        .getByLabel('Integration')
        .selectOption({ value: MARKET_SEED_CONNECTION_IDS.invoicing });

      await modal.getByTestId('rule-test-sample-order').click();
      await modal.getByLabel('Sample order delivery country').fill(COUNTRY);
      await modal.getByLabel('Sample order total amount').fill('42');
      await modal.getByLabel('Sample order currency').fill('EUR');

      await modal.getByTestId('rule-run-sample-order-test').click();

      const result = modal.getByTestId('rule-test-sample-order-result');
      await expect(result).toBeVisible({ timeout: 15_000 });
      await expect(result).toContainText('via an already-saved rule at');
      await expect(result).not.toContainText('via the rule you are drafting');
    } finally {
      await api.salesDocuments.deleteCountryDefault(countryDefault.id);
    }
  });
});
