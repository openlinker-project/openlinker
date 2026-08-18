/**
 * Invoicing: the persisted sales-document block, end to end (#2100)
 *
 * ADR-041 §54/§105 require that a decision NOT to issue a fiscal document is
 * persisted and operator-visible, never log-only. This spec proves the operator
 * half of that contract against a live API + database: the API carries the
 * reason, the aggregate counts only the attention-worthy subset, the filter
 * composes with the health axis, and all four `/orders` surfaces state the cause.
 *
 * SCOPE, stated plainly so the coverage claim is not overread. This spec verifies
 * the READ path — the API projection plus every operator surface — against orders
 * whose block is already persisted. It does NOT drive the write: producing one
 * genuinely needs a marketplace order to transition through
 * `AutoIssueTriggerService` on a stack with two `Invoicing` connections and no
 * primary, which is a live-purchase flow. The write path (which reason on which
 * exit, the invoice-aware suppression, the level-triggered clear, the
 * `indeterminate` no-op) is covered by
 * `libs/core/src/invoicing/application/services/auto-issue-trigger.service.spec.ts`
 * and `apps/api/test/integration/order-health-summary.int-spec.ts` against real
 * Postgres.
 *
 * SELF-CONFIGURING: skips per test when the stack carries no blocked order, so it
 * is inert on a stack that has never hit the state and green on one that has.
 * Read-only — it issues no document, mutates no order, and needs no fixture.
 *
 * @module tests/invoicing
 */
import { test, expect } from '../../src/fixtures/test';
import type { Page } from '@playwright/test';

/**
 * Reasons the aggregate and the list filter act on — everything except
 * `trigger-model-manual`, which is `parseTriggerModel`'s DEFAULT and therefore
 * true of every uninvoiced order on a manual install. Mirrors
 * `SalesDocumentAttentionReasonValues`; the e2e package deliberately does not
 * depend on `@openlinker/core`.
 */
const ATTENTION_REASONS = [
  'unresolved-routing',
  'missing-required-tax-id',
  'tax-rate-conflict',
  'trigger-model-batched',
];

/** Badge label per reason, mirroring `invoicingBlockedBadge`. */
const BADGE_LABEL: Record<string, string> = {
  'unresolved-routing': 'No primary',
  'trigger-model-manual': 'Manual only',
  'trigger-model-batched': 'Batched',
};


/** Wait for the orders table to have painted at least one row. */
async function awaitRows(page: Page): Promise<void> {
  await expect(page.locator('.data-table__row').first()).toBeVisible({ timeout: 30_000 });
}

test.describe('invoicing: persisted sales-document block (#2100)', () => {
  test('the API projects the reason, its paired routing reason, and a PII-free detail', async ({
    api,
  }) => {
    const orders = await api.orders.list({ limit: 100 });
    const blocked = orders.items.filter((o) => o.salesDocumentBlockReason !== null);

    test.skip(blocked.length === 0, 'stack carries no order with a persisted block');

    for (const order of blocked) {
      // Only ADR-041 vocabulary reaches the wire.
      expect([...ATTENTION_REASONS, 'trigger-model-manual']).toContain(
        order.salesDocumentBlockReason,
      );

      // §107: the routing reason travels ONLY alongside the bridge value.
      if (order.salesDocumentBlockReason === 'unresolved-routing') {
        expect(order.salesDocumentUnresolvedReason).not.toBeNull();
      } else {
        expect(order.salesDocumentUnresolvedReason).toBeNull();
      }

      // The detail is rendered verbatim to an operator, so it must stay PII-free:
      // ids, counts and neutral vocabulary only.
      if (order.salesDocumentBlockDetail !== null) {
        expect(order.salesDocumentBlockDetail).toMatch(/^[\w\s,.'()-]+$/);
        expect(order.salesDocumentBlockDetail).not.toMatch(/@/);
      }
    }
  });

  test('the aggregate is orthogonal to health and excludes the manual default', async ({ api }) => {
    const summary = await api.orders.statusSummary();

    test.skip(
      summary.salesDocumentBlocked === undefined,
      'API predates the sales-document block count',
    );

    // The five health buckets still partition the set — the block count rides
    // alongside them and must never be added in.
    expect(
      summary.sourceDeleted +
        summary.awaitingMapping +
        summary.needsAttention +
        summary.synced +
        summary.awaitingDispatch,
    ).toBe(summary.total);

    const orders = await api.orders.list({ limit: 100 });
    const attentionWorthy = orders.items.filter(
      (o) => ATTENTION_REASONS.includes(o.salesDocumentBlockReason ?? ''),
    );
    const manualOnly = orders.items.filter(
      (o) => o.salesDocumentBlockReason === 'trigger-model-manual',
    );

    // The count follows the attention subset, not "has any reason". Counting the
    // manual default would report every order on a manual install as blocked.
    expect(summary.salesDocumentBlocked).toBe(attentionWorthy.length);
    if (manualOnly.length > 0) {
      expect(summary.salesDocumentBlocked).toBeLessThan(
        attentionWorthy.length + manualOnly.length,
      );
    }
  });

  test('the list filter returns exactly the attention-worthy blocks and rejects a stray value', async ({
    api,
  }) => {
    const all = await api.orders.list({ limit: 100 });
    const expected = all.items
      .filter(
        (o) => ATTENTION_REASONS.includes(o.salesDocumentBlockReason ?? ''),
      )
      .map((o) => o.internalOrderId)
      .sort();

    test.skip(expected.length === 0, 'stack carries no attention-worthy block');

    const filtered = await api.orders.list({ limit: 100, salesDocumentBlocked: true });
    expect(filtered.items.map((o) => o.internalOrderId).sort()).toEqual(expected);

    // A stray value must 400, not silently return the UNFILTERED list while the
    // UI renders the filter as applied.
    await expect(api.orders.list({ limit: 100, salesDocumentBlocked: 'yes' })).rejects.toThrow();
  });

  test('the orders list badges the block and drops the Issue-invoice CTA', async ({
    api,
    page,
  }) => {
    const orders = await api.orders.list({ limit: 100 });
    const blocked = orders.items.find(
      (o) => o.salesDocumentBlockReason !== null && o.salesDocumentBlockReason !== 'trigger-model-manual',
    );

    test.skip(blocked === undefined, 'stack carries no non-manual block');

    await page.goto('/orders');
    await awaitRows(page);

    const label = BADGE_LABEL[blocked!.salesDocumentBlockReason!];
    const badge = page.getByText(label, { exact: true }).first();
    await expect(badge).toBeVisible();

    // The cause must reach the DOM as BOTH a tooltip and an accessible name —
    // `title` alone is unreachable by keyboard and unreliable in screen readers.
    const wrapper = badge.locator('xpath=ancestor::span[@title][1]');
    await expect(wrapper).toHaveAttribute('title', /.+/);
    await expect(wrapper).toHaveAttribute('aria-label', new RegExp(label));

    // An order OpenLinker already refused is not one waiting for a click, so the
    // row's own cell must not still invite the operator to issue it by hand.
    const row = badge.locator('xpath=ancestor::tr[1]');
    await expect(row.getByRole('link', { name: /issue invoice/i })).toHaveCount(0);
  });

  test('a manual-only block keeps the Issue-invoice CTA beside its neutral badge', async ({
    api,
    page,
  }) => {
    const orders = await api.orders.list({ limit: 100 });
    const manual = orders.items.find(
      (o) => o.salesDocumentBlockReason === 'trigger-model-manual',
    );

    test.skip(manual === undefined, 'stack carries no manual-only block');

    await page.goto('/orders');
    await awaitRows(page);

    const badge = page.getByText('Manual only', { exact: true }).first();
    await expect(badge).toBeVisible();

    // Issuing by hand IS this connection's configured workflow, so the affordance
    // stays — the badge explains, it does not forbid.
    const row = badge.locator('xpath=ancestor::tr[1]');
    await expect(row.getByRole('link', { name: /issue invoice/i })).toBeVisible();
  });

  test('the counted filter chip narrows the list and survives being cleared', async ({
    api,
    page,
  }) => {
    const summary = await api.orders.statusSummary();
    test.skip(!summary.salesDocumentBlocked, 'nothing attention-worthy is blocked');

    await page.goto('/orders');
    await awaitRows(page);

    const chip = page.getByRole('button', { name: /invoicing blocked/i });
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(String(summary.salesDocumentBlocked));
    await expect(chip).toHaveAttribute('aria-pressed', 'false');

    await chip.click();

    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(page.url()).toContain('invoicing=blocked');
    await expect(page.locator('.data-table__row')).toHaveCount(summary.salesDocumentBlocked!);

    // The chip must stay mounted while the filter is active — gating it on the
    // count alone stranded the param with no control to clear it.
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(page.url()).not.toContain('invoicing=blocked');
  });

  test('the order detail states the cause in the invoice panel and on the timeline', async ({
    api,
    page,
  }) => {
    const orders = await api.orders.list({ limit: 100 });
    const noPrimary = orders.items.find(
      (o) => o.salesDocumentUnresolvedReason === 'ambiguous-connection-no-primary',
    );

    test.skip(noPrimary === undefined, 'stack carries no no-primary block');

    await page.goto(`/orders/${noPrimary!.internalOrderId}`);

    // The panel reads the PERSISTED reason rather than re-deriving the ambiguity
    // from the connection list, so backend and frontend cannot disagree.
    await expect(page.getByText(/Not invoiced: no primary connection/i)).toBeVisible({
      timeout: 30_000,
    });
    if (noPrimary!.salesDocumentBlockDetail !== null) {
      // The detail legitimately appears TWICE — the panel alert and the timeline
      // entry — so this is a first-match assertion, not a strict-mode one.
      await expect(page.getByText(noPrimary!.salesDocumentBlockDetail!).first()).toBeVisible();
    }

    // One-click remediation: the link must land on the connection EDIT form, the
    // only surface carrying the primary toggle.
    const setPrimary = page.getByRole('link', { name: /set a primary/i });
    await expect(setPrimary).toBeVisible();
    await expect(setPrimary).toHaveAttribute('href', /\/connections\/[^/]+\/edit$/);

    // And the timeline narrates it as its own entry.
    await expect(page.getByText('No invoice issued')).toBeVisible();
  });
});
