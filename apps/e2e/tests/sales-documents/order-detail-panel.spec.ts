/**
 * Sales documents: the order-detail "Sales document" panel, end to end
 * (#2563 M10)
 *
 * Verifies `SalesDocumentPanel`
 * (`apps/web/src/features/orders/components/sales-document-panel.tsx`)
 * against the "Order" page of `docs/plans/mockups/sales-document-routing.html`
 * — the third and last M10 verification target. The panel's own doc comment
 * names four states (filled-invoice, filled-receipt, empty+reason,
 * blocked-by-other-kind) and this suite covers a representative sub-state of
 * each PLUS two states the shipped code carries beyond the mockup's own
 * scope (a rejected authority transmission, a duplicate document on a second
 * connection) — chosen because `sales-document-seed.ts` (built for the
 * orders-list-cell task) already seeds them for free, and skipping states a
 * fixture already produces would be a worse use of the same setup cost.
 *
 * FIXTURE DATA: reuses `seedSalesDocumentStates` / `SEED_ORDER_IDS`
 * (`src/support/sales-document-seed.ts`) verbatim — the same eight orders and
 * their `invoice_records` / `fiscal_registration_records` rows the
 * orders-list-cell spec seeds, navigated to individually via
 * `/orders/:internalOrderId` instead of read off the list. No new seed logic
 * was needed: every state this panel can show with no live worker running
 * (issued, authority-rejected, registering, in-doubt, duplicate, and the bare
 * empty state) was already a row in that fixture.
 *
 * NOT COVERED, and why: the panel's `pending`/`issuing` invoice sub-states and
 * the fiscal `stalled`/`interrupted` sub-states depend on either a live
 * worker mid-attempt or `FiscalRegistrationProgressQuery` reading a real job
 * row (`fiscal_registration_progress` has no HTTP write path and this
 * package's DB-seed exception is scoped to what `sales-document-seed.ts`
 * already covers, not a new table). Exhaustively reproducing every one of the
 * panel's ~13 sub-states would need its own dedicated fixture design — out of
 * proportion to this task alongside the two prior M10 verification passes.
 *
 * VIEWPORT COVERAGE: full content assertions run at desktop width for every
 * state (the panel is a single-column `detail-section`, not a table with a
 * `layout` prop like the orders-list cell, so there is no separate mobile
 * rendering path to diverge) — screenshots are taken at all three widths for
 * two representative states (filled-invoice-issued, empty-with-override) to
 * confirm the panel reflows without clipping, per the task's own screenshot
 * requirement.
 *
 * @module tests/sales-documents
 */
import { test, expect } from '../../src/fixtures/test';
import type { Page, Locator } from '@playwright/test';
import { seedSalesDocumentStates, SEED_ORDER_IDS } from '../../src/support/sales-document-seed';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCREENSHOT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__screenshots__',
);

const VIEWPORTS = [
  { label: 'desktop-1440', width: 1440, height: 1400 },
  { label: 'tablet-768', width: 768, height: 1800 },
  { label: 'mobile-360', width: 360, height: 2400 },
] as const;

async function gotoOrder(page: Page, orderId: string): Promise<void> {
  await page.goto(`/orders/${orderId}`);
  await expect(page.locator('.sales-document-panel')).toBeVisible({ timeout: 30_000 });
}

function panel(page: Page): Locator {
  return page.locator('.sales-document-panel');
}

test.beforeAll(async () => {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await seedSalesDocumentStates();
});

test.describe('sales documents: order-detail panel (#2563 M10)', () => {
  test('filled — issued invoice shows the regulatory badge and the full field list', async ({
    page,
  }) => {
    await gotoOrder(page, SEED_ORDER_IDS.invoiceIssued);
    const slot = panel(page).locator('.doc-slot--filled');
    await expect(slot).toBeVisible();
    await expect(slot.locator('.doc-slot__kind')).toHaveText('invoice');

    // Regulatory badge renders only when `regulatoryStatus !== 'not-applicable'`
    // — this order's seeded `'accepted'` clears that bar. Matched against the
    // KV row's own `<dt>` exactly: `getByText('Clearance')` also matches the
    // unrelated "Clearance status" / "Proof of clearance" copy elsewhere on
    // the order-detail page (measured live — a substring match is too loose
    // here).
    await expect(slot.getByText('Clearance', { exact: true })).toBeVisible();
    await expect(slot.getByText('Number', { exact: true })).toBeVisible();
    await expect(slot.getByText('Document', { exact: true })).toBeVisible();
    await expect(slot.getByText('Issued', { exact: true })).toBeVisible();

    // No rejection alert, no duplicate warning, no cross-kind block — this is
    // the plain "everything worked" filled state.
    await expect(page.getByText('The authority rejected this transmission')).toHaveCount(0);
    await expect(page.getByText('more than one connection')).toHaveCount(0);
  });

  test('filled — an authority rejection offers Resend, never a re-issue', async ({ page }) => {
    await gotoOrder(page, SEED_ORDER_IDS.invoiceAuthorityRejected);
    const slot = panel(page).locator('.doc-slot--filled');
    await expect(
      slot.getByText('The authority rejected this transmission'),
    ).toBeVisible();
    await expect(
      slot.getByText(
        'The document was issued; only its transmission failed.',
        { exact: false },
      ),
    ).toBeVisible();
    await expect(slot.getByRole('button', { name: 'Resend' })).toBeVisible();
    // Never a "retry/re-issue" affordance beside a rejection — re-issuing
    // would create a SECOND document for an already-issued one.
    await expect(slot.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  });

  test('filled — a document on a second connection surfaces as a duplicate warning', async ({
    page,
  }) => {
    await gotoOrder(page, SEED_ORDER_IDS.invoiceAtAuthorityDuplicate);
    const slot = panel(page).locator('.doc-slot--filled');
    await expect(
      slot.getByText('This order has documents on more than one connection.'),
    ).toBeVisible();
    await expect(
      slot.getByText('Check both providers and correct whichever document', { exact: false }),
    ).toBeVisible();
  });

  test('filled — a receipt mid-registration blocks the invoice slot rather than showing a plain notice', async ({
    page,
  }) => {
    await gotoOrder(page, SEED_ORDER_IDS.fiscalRegistering);
    const slot = panel(page).locator('.doc-slot--filled');
    await expect(slot.locator('.doc-slot__kind')).toHaveText('fiscal receipt');

    // DIVERGENCE FROM WHAT THE `registering` STATUS ALONE SUGGESTS, measured
    // live: this order's ONE active connection with `Invoicing` enabled
    // (`ksef`, seeded for a different order's routing default) is also a
    // structural candidate HERE, so `showFiscalSlot`'s cross-kind guard fires
    // — a non-retryable `registering` record blocks the invoice side exactly
    // like a terminal one would (ADR-041 §3b: invoice or receipt, never
    // both). The plain "Registering with the provider…" body notice this
    // fixture's comment describes is REACHED only when `fiscalProgress` comes
    // back `undefined` (no live job-progress read at all); here the progress
    // endpoint answers a real value even with no worker running, so that
    // branch never fires. Both facts are real and worth knowing separately:
    // the cross-kind block below, and that a live `fiscalProgress` read
    // always beats the "nothing is known" body.
    await expect(
      slot.getByText('This order already has a document'),
    ).toBeVisible();
    await expect(
      slot.getByText('This order already has a fiscal receipt.', { exact: false }),
    ).toBeVisible();
    // Nothing to click while a registration is genuinely in flight — the
    // exactly-once guarantee (ADR-042) means a second attempt can only be a
    // 409, so the UI offers no button here at all.
    await expect(slot.getByRole('button', { name: 'Register receipt' })).toHaveCount(0);
  });

  test('filled — an unconfirmed receipt never offers a blind retry', async ({ page }) => {
    await gotoOrder(page, SEED_ORDER_IDS.fiscalUnconfirmed);
    const slot = panel(page).locator('.doc-slot--filled');
    await expect(
      slot.getByText('This sale may already be registered'),
    ).toBeVisible();
    await expect(
      slot.getByText('Registering again could produce a second fiscal receipt', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(slot.getByRole('button', { name: 'Look it up' })).toBeVisible();
    await expect(slot.getByRole('button', { name: 'Register receipt' })).toHaveCount(0);
  });

  test('empty — no routing decided demotes both manual overrides behind a disclosure for an admin', async ({
    page,
  }) => {
    await gotoOrder(page, SEED_ORDER_IDS.noRouting);
    const slot = panel(page).locator('.doc-slot').filter({ hasNot: page.locator('.doc-slot--filled') });
    await expect(slot.locator('.doc-slot__kind')).toHaveText('nothing issued');

    // #2807 — the manual override is demoted behind a closed-by-default
    // disclosure — the buttons are not visible until it is opened. (This
    // seeded order's candidate pool spans BOTH kinds — `blockCopyKind` is
    // `'mixed'` — so `resolveSalesDocumentBlockCopy`'s client-derived
    // ambiguity copy, which only fires for a pure-invoice pool, does not
    // render here and there is no primary "Fix routing settings" CTA to
    // assert against this particular fixture; that CTA is exercised by
    // `sales-document-panel.test.tsx` at the unit level instead.)
    const overrideSummary = page.getByText('Issue or register manually instead');
    await expect(overrideSummary).toBeVisible();
    await expect(page.getByRole('button', { name: 'Issue invoice' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Register receipt' })).toHaveCount(0);

    await overrideSummary.click();
    await expect(page.getByRole('button', { name: 'Issue invoice' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Register receipt' })).toBeVisible();
    await expect(
      page.getByText('This applies to this order only.').first(),
    ).toBeVisible();
  });

  test('filled — a registered fiscal receipt shows the artefact and a final-registration notice', async ({
    page,
  }) => {
    await gotoOrder(page, SEED_ORDER_IDS.fiscalRegistered);
    const slot = panel(page).locator('.doc-slot--filled');
    await expect(slot.locator('.doc-slot__kind')).toHaveText('fiscal receipt');
    await expect(slot.getByText('PAR/2026/09/0009', { exact: false })).toBeVisible();
    await expect(
      slot.getByText('This registration is final and cannot be corrected here.'),
    ).toBeVisible();
    // A registered receipt is TERMINAL, so no retry/register affordance
    // belongs beside it, and this order's active `Invoicing`-capable
    // connection (ksef, seeded for a different order's routing default) makes
    // it ALSO a cross-kind candidate — the same real guard exercised by the
    // `fiscalRegistering` state above, now against a settled record.
    await expect(slot.getByRole('button', { name: 'Register receipt' })).toHaveCount(0);
    await expect(
      slot.getByText('This order already has a fiscal receipt.', { exact: false }),
    ).toBeVisible();
  });

  test('real UX: opening the manual-override disclosure and clicking Issue invoice actually performs the issue request', async ({
    page,
  }) => {
    // `invoiceNotIssued` is routed to a real connection (ksef, DE default) but
    // carries no document yet, so the primary action is genuinely clickable —
    // unlike `noRouting`, whose disclosure has no resolvable connection to
    // issue on. Clicking it round-trips through the REAL `POST /invoices`
    // endpoint against the seeded (fake-credentialed) `ksef` connection, so
    // this asserts the button actually performs an action with an observable
    // result — not just that it exists and is clickable in the DOM.
    await gotoOrder(page, SEED_ORDER_IDS.invoiceNotIssued);
    const overrideSummary = page.getByText('Issue or register manually instead');
    await expect(overrideSummary).toBeVisible();
    await overrideSummary.click();

    const issueButton = page.getByRole('button', { name: 'Issue invoice' });
    await expect(issueButton).toBeVisible();
    await expect(issueButton).toBeEnabled();

    const live = page.locator('.sales-document-panel [role="status"][aria-live="polite"]');
    await issueButton.click();

    // The live region announces "issuing" the instant the mutation starts —
    // real state driven by a real click, not a static fixture.
    await expect(live).toHaveText('Issuing the invoice.');

    // The seeded `ksef` connection carries a fake `credentialsRef`
    // ('seed-ksef'), so the real adapter call is expected to fail — that
    // failure IS the assertion that a genuine network round trip happened:
    // either a toast reports it, or the panel re-reads and shows a resolved
    // document. Either outcome proves the click drove real backend work
    // rather than a decorative disabled/enabled toggle.
    await expect(
      page.locator('.toast--error, .toast--success').first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('the live region announces state changes for assistive tech', async ({ page }) => {
    await gotoOrder(page, SEED_ORDER_IDS.invoiceIssued);
    const live = page.locator('.sales-document-panel [role="status"][aria-live="polite"]');
    await expect(live).toBeAttached();
    // Empty at rest — nothing has been announced yet on a page that performed
    // no action.
    await expect(live).toHaveText('');
  });

  for (const viewport of VIEWPORTS) {
    test(`the filled-invoice state renders at ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoOrder(page, SEED_ORDER_IDS.invoiceIssued);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${viewport.label}-panel-filled-invoice.png`),
      });
    });

    test(`the empty-with-override state renders at ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoOrder(page, SEED_ORDER_IDS.noRouting);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${viewport.label}-panel-empty-override.png`),
      });
    });

    // #2807 review — no fiscal-receipt state had ever been captured in a
    // screenshot; only invoice-filled and empty-override were. This closes
    // that gap with the "registered" (terminal, successful) sub-state, the
    // one an operator sees most often.
    test(`the filled-fiscal state renders at ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoOrder(page, SEED_ORDER_IDS.fiscalRegistered);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${viewport.label}-panel-filled-fiscal.png`),
      });
    });
  }
});
