/**
 * Sales documents: the KSeF-branded regulatory-status label vs. the shared
 * neutral one, on the SAME invoice detail page (#3181)
 *
 * #3181 moved the KSeF-specific status wording ("KSeF: accepted", …) out of
 * the shared, regulator-neutral `RegulatoryStatusBadge`
 * (`apps/web/src/features/invoicing/components/regulatory-status-badge.tsx`)
 * and into the ksef plugin's own `KSEF_REGULATORY_STATUS_LABELS` map
 * (`apps/web/src/plugins/ksef/lib/ksef-regulatory-status-labels.ts`), passed
 * in via the badge's optional `labelOverrides` prop. The shared component's
 * OWN default fallback stays regulator-neutral ("Accepted", not
 * "KSeF: accepted") so a non-KSeF `InvoicingPort` adapter (inFakt, Subiekt)
 * never inherits KSeF's wording (ADR-026 country-agnostic design).
 *
 * `/invoices/:invoiceId` (`InvoiceDetailPage`) is the one page that renders
 * BOTH spellings for the same record in one load, which is why this spec
 * needs no second navigation to prove the split:
 *   - the page's own "Regulatory clearance" KV row renders the shared
 *     `RegulatoryStatusBadge` with NO override → the neutral fallback,
 *   - the ksef plugin's `invoiceDetailSection` slot (`KsefInvoiceDetailSection`,
 *     resolved by `usePlatform(connection.platformType)` — zero `platformType`
 *     literals in the page itself) renders the SAME shared component with
 *     `labelOverrides={KSEF_REGULATORY_STATUS_LABELS}` → the branded wording.
 *
 * FIXTURE DATA: reuses `seedSalesDocumentStates` / `SEED_ORDER_IDS` /
 * `SEED_CONNECTION_IDS` (`src/support/sales-document-seed.ts`) verbatim — the
 * same `invoiceIssued` order the order-detail-panel suite already seeds,
 * whose `invoice_records` row is `providerType: 'ksef'`,
 * `regulatoryStatus: 'accepted'`. No new seed logic: this is the one existing
 * fixture row that already reaches KSeF's `accepted` state with no live
 * worker required. The row's id is minted by `uuid_generate_v4()` at seed
 * time, so it is fetched via `GET /orders/:orderId/invoice` rather than
 * hardcoded.
 *
 * @module tests/sales-documents
 */
import { test, expect } from '../../src/fixtures/test';
import {
  seedSalesDocumentStates,
  SEED_ORDER_IDS,
  SEED_CONNECTION_IDS,
} from '../../src/support/sales-document-seed';

test.describe('sales documents: KSeF-branded regulatory label vs. the shared neutral one (#3181)', () => {
  test.beforeAll(async () => {
    await seedSalesDocumentStates();
  });

  test('the ksef plugin section renders "KSeF: accepted" while the shared KV row renders the neutral "Accepted"', async ({
    page,
    api,
  }) => {
    const invoice = await api.invoices.getForOrder(
      SEED_ORDER_IDS.invoiceIssued,
      SEED_CONNECTION_IDS.ksef,
    );
    expect(invoice.regulatoryStatus, 'seeded invoice is at the accepted clearance state').toBe(
      'accepted',
    );

    await page.goto(`/invoices/${invoice.id}`);

    // The plugin-owned, KSeF-branded surface — `KsefInvoiceDetailSection`'s
    // "Clearance status" slot row.
    const ksefSection = page.locator('.invoice-detail-section--ksef');
    await expect(ksefSection).toBeVisible();
    await expect(ksefSection.getByText('KSeF: accepted', { exact: true })).toBeVisible();

    // The shared, regulator-neutral surface — the page's own "Regulatory
    // clearance" KV row, which passes NO `labelOverrides` and must therefore
    // never carry the KSeF-branded word, even though it renders the exact
    // same underlying `RegulatoryStatus` value for the exact same record.
    const kvList = page.locator('.key-value-list');
    const clearanceRow = kvList
      .locator('dt', { hasText: 'Regulatory clearance' })
      .locator('xpath=following-sibling::dd[1]');
    await expect(clearanceRow).toBeVisible();
    await expect(clearanceRow.getByText('Accepted', { exact: true })).toBeVisible();
    await expect(clearanceRow.getByText('KSeF: accepted')).toHaveCount(0);
  });

  test('the invoices list row — a fully separate surface — also renders the neutral word, never the branded one', async ({
    page,
  }) => {
    // Scoped to the ksef connection alone (`?connectionId=`, a real
    // `InvoicesListPage` filter — confirmed against the page's own
    // `searchParams.get('connectionId')` read) so this assertion is about
    // the `invoiceIssued` row's own document, not an unrelated one.
    //
    // `InvoicesListPage` renders `<RegulatoryStatusBadge status={r.regulatoryStatus} />`
    // on every row with NO `labelOverrides` — confirmed by reading the
    // component (`apps/web/src/pages/invoicing/invoices-list-page.tsx`)
    // rather than asserted as a guess, since the list is a fully independent
    // render path from the detail page above and must not silently inherit
    // branding from a shared hook or context.
    await page.goto(`/invoices?connectionId=${SEED_CONNECTION_IDS.ksef}`);
    await expect(page.locator('table')).toBeVisible();
    await expect(page.getByText('Accepted', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('KSeF: accepted')).toHaveCount(0);
  });
});
