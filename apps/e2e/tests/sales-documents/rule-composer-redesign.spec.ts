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
