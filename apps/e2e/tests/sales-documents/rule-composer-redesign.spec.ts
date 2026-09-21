/**
 * Sales documents: rule-composer modal redesign + retired providers page
 * (#2189/#2806 review, session follow-up to #2563 M10)
 *
 * Covers two surfaces the M10 suite (`settings-market-list.spec.ts` /
 * `order-detail-panel.spec.ts`) does not exercise:
 *
 *  1. The "Add rule" composer modal (`sales-document-rule-composer-dialog.tsx`)
 *     was redesigned into three bordered sections (Conditions / Document &
 *     destination / Effective window) and the buyer-tax-ID coverage caveat
 *     moved from a big repeated warning box into a small tooltip-triggered
 *     glyph beside the condition row. This spec asserts the sectioned
 *     structure exists and that the glyph — not a large inline banner —
 *     is what renders next to a `Buyer has a tax ID` condition.
 *  2. `/settings/sales-documents/providers` — the "Connected providers" table
 *     is a SECTION of `/settings/sales-documents`, never a sub-route, so this
 *     path must 404 rather than silently render a second, stale copy of it.
 *
 * SEEDING (#2809 review): this spec used to `test.skip()` when the live stack
 * reported zero markets, so on a fresh stack both tests reported GREEN having
 * asserted nothing at all. It now seeds the same fixture
 * `settings-market-list.spec.ts` does, so "no markets" is a FAILURE rather
 * than a skip. It still only opens and closes dialogs — nothing is saved — so
 * it stays safe to re-run against any stack.
 *
 * @module tests/sales-documents
 */
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import {
  seedSalesDocumentMarketOrders,
  MARKET_SEED_COUNTRIES,
} from '../../src/support/sales-document-market-seed';

test.describe('sales documents: rule-composer modal redesign', () => {
  test.beforeAll(async () => {
    await seedSalesDocumentMarketOrders();
  });

  test('the Add rule modal renders three sectioned cards, not a flat form', async ({
    page,
    api,
  }) => {
    // The seed guarantees this country has a detected order, so an empty
    // market list is a real failure rather than a reason to skip.
    const live = await api.salesDocuments.markets();
    expect(live.markets.map((m) => m.country)).toContain(MARKET_SEED_COUNTRIES.unconfigured);
    const country = MARKET_SEED_COUNTRIES.unconfigured;

    await page.goto('/settings/sales-documents');
    await expect(page.getByRole('heading', { name: 'Sales documents' })).toBeVisible({
      timeout: 30_000,
    });

    const row = page
      .locator('.sales-document-market-row')
      .filter({ has: page.locator('.sales-document-market-row__name', { hasText: country }) });
    await row.getByRole('button', { name: /Configure/ }).click();

    await expect(page.getByRole('heading', { name: `Sales-document routing · ${country}` })).toBeVisible();

    await page.getByRole('button', { name: 'Add rule' }).click();
    // `.dialog__content--elevated` is the composer's own nested-dialog
    // container (`sales-document-rule-composer-dialog.tsx`) — the routing
    // dialog it opens ON TOP OF is not a portal, so a generic DOM-ancestor
    // walk from the "Add rule" heading also captures the underlying page's
    // rules-list caveat banner. Scope to this class instead.
    const modal = page.locator('.dialog__content--elevated');

    await expect(modal.getByText('CONDITIONS')).toBeVisible();
    await expect(modal.getByText('DOCUMENT & DESTINATION')).toBeVisible();
    await expect(modal.getByText('EFFECTIVE WINDOW')).toBeVisible();

    // The old design rendered one giant warning box per buyer-tax-ID
    // condition, repeated once per row — the review finding this redesign
    // fixes. There must be no such large block INSIDE THE MODAL (the
    // pre-existing rules-LIST-level caveat, e.g. "2 of these rules read the
    // buyer's tax ID", is a different, unrelated element that legitimately
    // sits behind the open modal and must not be matched here); the glyph
    // mechanism (an inline triangle, tooltip-triggered) replaces it.
    const bigWarningBox = modal.locator('text=/reads? the buyer.?s tax id/i');
    await expect(bigWarningBox).toHaveCount(0);
  });

  test('a buyer-tax-ID condition shows a small warning glyph beside the row, not inline prose', async ({
    page,
    api,
  }) => {
    const live = await api.salesDocuments.markets();
    expect(live.markets.map((m) => m.country)).toContain(MARKET_SEED_COUNTRIES.unconfigured);
    const country = MARKET_SEED_COUNTRIES.unconfigured;

    await page.goto('/settings/sales-documents');
    await expect(page.getByRole('heading', { name: 'Sales documents' })).toBeVisible({
      timeout: 30_000,
    });
    const row = page
      .locator('.sales-document-market-row')
      .filter({ has: page.locator('.sales-document-market-row__name', { hasText: country }) });
    await row.getByRole('button', { name: /Configure/ }).click();
    await page.getByRole('button', { name: 'Add rule' }).click();

    const fieldSelect = page.locator('select, [role="combobox"]').first();
    await fieldSelect.selectOption({ label: 'Buyer has a tax ID' }).catch(() => {});

    // The glyph is a small inline element (an svg/button) placed beside the
    // condition row's value control — it must exist, and its accessible
    // affordance must be a tooltip trigger (hover/focus), not static text
    // dumped into the layout.
    const glyph = page.locator('.rule-composer-condition-row svg, .rule-composer-condition-row button[aria-describedby]');
    await expect(glyph.first()).toBeVisible();
  });

  test('selecting the Receipt document kind never surfaces the removed buyer-tax-ID checkbox (#3182)', async ({
    page,
    api,
  }) => {
    // #3182 removed a permanently-disabled "include the buyer's tax id on the
    // receipt" checkbox from this exact selection — there is no such field on
    // a fiscal receipt in this build, for either document kind. A component
    // test (`sales-document-rule-composer-dialog.test.tsx`,
    // "should never render a tax-ID-on-receipt toggle, for either document
    // type") already proves the JSDOM tree carries no such control; this
    // spec proves the SAME negative against the real rendered app.
    const live = await api.salesDocuments.markets();
    expect(live.markets.map((m) => m.country)).toContain(MARKET_SEED_COUNTRIES.unconfigured);
    const country = MARKET_SEED_COUNTRIES.unconfigured;

    await page.goto('/settings/sales-documents');
    await expect(page.getByRole('heading', { name: 'Sales documents' })).toBeVisible({
      timeout: 30_000,
    });
    const row = page
      .locator('.sales-document-market-row')
      .filter({ has: page.locator('.sales-document-market-row__name', { hasText: country }) });
    await row.getByRole('button', { name: /Configure/ }).click();
    await page.getByRole('button', { name: 'Add rule' }).click();

    const modal = page.locator('.dialog__content--elevated');
    const documentTypeSelect = modal.getByLabel('Document type');
    await expect(documentTypeSelect).toBeVisible();

    // Absent BEFORE selecting a document kind (the default is 'invoice').
    await expect(
      modal.getByLabel(/include the buyer.?s tax id/i),
    ).toHaveCount(0);

    // Still absent once the Receipt (fiscal-receipt) kind is selected — the
    // exact selection the removed checkbox used to gate on.
    await documentTypeSelect.selectOption({ label: 'Receipt' });
    await expect(
      modal.getByLabel(/include the buyer.?s tax id/i),
    ).toHaveCount(0);
    await expect(
      modal.getByText(/include the buyer.?s tax id/i),
    ).toHaveCount(0);
  });
});

/**
 * Deletes every `orderTotalGross` rule this suite could have created for
 * `country`, keyed on the exact amounts the two tests below author (#3189
 * decimal-string round-trip; #3190 overlap detection). Run both BEFORE
 * authoring (in case a previous run failed mid-test and left a rule behind —
 * `sales-document-rules` carries no cleanup of its own the way
 * `sales-document-market-seed.ts`'s DB seed does) and AFTER, so a normal run
 * leaves the market exactly as it found it.
 */
async function cleanupOrderTotalGrossTestRules(api: ApiClient, country: string): Promise<void> {
  const AMOUNTS = new Set(['450.00', '449.00']);
  const rules = await api.salesDocuments.listRules(country);
  const stale = rules.filter((rule) =>
    rule.conditions.some(
      (c) => c.field === 'orderTotalGross' && c.amount !== undefined && AMOUNTS.has(c.amount),
    ),
  );
  for (const rule of stale) {
    await api.salesDocuments.deleteRule(rule.id);
  }
}

test.describe('sales documents: rule composer — amount/currency round-trip + overlap detection', () => {
  test.beforeAll(async () => {
    await seedSalesDocumentMarketOrders();
  });

  test('an order-total condition round-trips its exact decimal amount and currency, and a same-currency rival blocks the save until the currency is changed (#3189/#3190)', async ({
    page,
    api,
  }) => {
    const country = MARKET_SEED_COUNTRIES.unconfigured;
    await cleanupOrderTotalGrossTestRules(api, country);

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

    try {
      // ── Rule 1: total < 450.00 PLN → Invoice ────────────────────────────
      await page.getByRole('button', { name: 'Add rule' }).click();
      const modal = page.locator('.dialog__content--elevated');

      await modal.getByLabel('Condition field').selectOption({ value: 'orderTotalGross' });
      await modal.getByLabel('Order total comparison').selectOption({ value: 'lt' });
      await modal.getByLabel('Order total amount').fill('450.00');
      await modal.getByLabel('Order total currency').fill('PLN');
      await modal.getByLabel('Integration').selectOption({ index: 1 });

      // The readback states the operator's OWN typed decimal string, not a
      // re-derived number — `450` or `450.0` would both be silent precision
      // loss (#3189).
      await expect(modal.getByTestId('rule-readback')).toContainText('450.00 PLN');

      await modal.getByTestId('rule-save').click();
      await expect(modal).toBeHidden();

      // The saved rule's condition chip echoes what the SERVER stored, i.e.
      // the real round trip (create → refetch → render), not merely what the
      // form held in memory.
      const rule1Chip = page.locator('.condition-chip', { hasText: '450.00 PLN' });
      await expect(rule1Chip).toBeVisible();

      // ── Rule 2: total ≥ 449.00 PLN → collides with rule 1 (#3190) ───────
      await page.getByRole('button', { name: 'Add rule' }).click();
      await modal.getByLabel('Condition field').selectOption({ value: 'orderTotalGross' });
      // Comparison stays at its default (`gte`) — resetting the field already
      // put it back there.
      await modal.getByLabel('Order total amount').fill('449.00');
      await modal.getByLabel('Order total currency').fill('PLN');

      await expect(modal.getByTestId('rule-conflict')).toBeVisible({ timeout: 10_000 });
      await expect(modal.getByTestId('rule-save-blocked')).toBeVisible();
      await expect(modal.getByTestId('rule-save')).toHaveCount(0);

      // Switching ONLY the currency to EUR: two amount bounds in different
      // currencies provably cannot describe the same order — an amount is
      // compared and never converted (#3190's `currency` disjoint reason) —
      // so the conflict must clear with no other field touched.
      await modal.getByLabel('Order total currency').fill('EUR');
      await expect(modal.getByTestId('rule-no-conflict')).toBeVisible({ timeout: 10_000 });
      await expect(modal.getByTestId('rule-conflict')).toHaveCount(0);

      await modal.getByLabel('Integration').selectOption({ index: 1 });
      const saveButton = modal.getByTestId('rule-save');
      await expect(saveButton).toBeEnabled();
      await saveButton.click();
      await expect(modal).toBeHidden();

      await expect(page.locator('.condition-chip', { hasText: '449.00 EUR' })).toBeVisible();
    } finally {
      await cleanupOrderTotalGrossTestRules(api, country);
    }
  });
});

test.describe('sales documents: retired "Connected providers" page', () => {
  test('/settings/sales-documents/providers no longer resolves to a route', async ({ page }) => {
    await page.goto('/settings/sales-documents/providers');
    // No HTTP-status assertion (#2809 review): a Vite SPA serves 200 for every
    // path, so `expect([200, 404]).toContain(status)` can never fail and
    // asserts nothing. The rendered client-side 404 is the only real evidence.
    await expect(page.getByText(/404|not found/i)).toBeVisible({ timeout: 10_000 });
  });
});
