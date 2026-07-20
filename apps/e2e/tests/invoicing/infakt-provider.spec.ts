/**
 * Invoicing: inFakt provider run (#1573, scenario 1)
 *
 * Unattended counterpart to the golden path's S8 (KSeF-only). Issues an
 * invoice on the inFakt connection for a REST-synthesized order (no
 * marketplace purchase — `synthesizeOrder` creates the order directly against
 * PrestaShop's webservice, which is a real `OrderSourcePort`), reconciles
 * clearance to `accepted`, and asserts the invoice carries the order's
 * shipping line + matching totals (#1567, reusing `assertInvoiceAmounts` the
 * same way the golden path's S8 does for KSeF).
 *
 * Self-configuring: skips with a clear reason when the stack has no inFakt
 * connection or no PrestaShop webservice key (order synthesis requires it).
 *
 * @module tests/invoicing
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import { synthesizeOrder, buildPrestashopWebserviceClient } from '../../src/support/order-synthesis';
import { assertInvoiceAmounts, toMinorUnits } from '../../src/support/parity';

interface OrderTotalsShape {
  subtotal: number | string;
  tax?: number | string;
  shipping?: number | string;
  total: number | string;
  currency: string;
  taxTreatment?: 'inclusive' | 'exclusive';
}
interface OrderSnapshotShape {
  items: Array<{ variantId?: string; price: number | string; quantity: number }>;
  totals: OrderTotalsShape;
}

test.describe('invoicing: inFakt provider run', () => {
  test('issues via inFakt, reconciles to accepted, and carries the shipping line', async ({
    api,
    world,
    jobs,
    poll,
  }, testInfo) => {
    const infakt = world.connectionFor(PlatformType.infakt);
    test.skip(!infakt, 'no inFakt connection on this stack');
    test.skip(
      !buildPrestashopWebserviceClient(world),
      'OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL) is required to synthesize an order',
    );

    const synthesized = await synthesizeOrder({ api, world, jobs, poll });
    const order = synthesized.order;

    await api.invoices.issue({ connectionId: infakt!.id, orderId: order.internalOrderId });
    const issued = await poll.until(
      () => api.invoices.getForOrder(order.internalOrderId, infakt!.id),
      (r) => r.status === 'issued' || r.status === 'issuing',
      { message: 'inFakt invoice to be issued', timeoutMs: 60_000 },
    );

    // Clearance is asynchronous (observed ~90s in manual runs) — re-trigger the
    // idempotent reconcile on every poll iteration rather than relying on the
    // 30-minute cron, mirroring the golden path's S8.
    const cleared = await poll.until(
      async () => {
        await jobs
          .trigger({
            connectionId: infakt!.id,
            jobType: 'invoicing.regulatoryStatus.reconcile',
            payload: { schemaVersion: 1 },
          })
          .catch(() => undefined);
        return api.invoices.getById(issued.id);
      },
      (r) => r.regulatoryStatus === 'accepted',
      { message: 'inFakt invoice to reach accepted', timeoutMs: 300_000, intervalMs: 10_000 },
    );
    expect(cleared.status).toBe('issued');

    const content = await api.invoices.getContent(cleared.id);
    const snapshot = order.orderSnapshot as unknown as OrderSnapshotShape;
    const currency = snapshot.totals.currency;

    // Shipping line (#1567): the order carries a positive shipping amount
    // (synthesizeOrder defaults to 9.99), so the mapper's `toShippingLine`
    // must append a line for it — assert it is present and its gross matches.
    const shippingMinor = toMinorUnits(snapshot.totals.shipping ?? 0, currency);
    expect(shippingMinor, 'synthesized order carries a positive shipping amount').toBeGreaterThan(0);
    const shippingLine = content.lines.find(
      (l) => toMinorUnits(l.gross, currency) === shippingMinor,
    );
    expect(shippingLine, 'invoice carries a line matching the order shipping amount').toBeTruthy();

    // Totals: item lines (gross containment) + the full order total (items +
    // shipping), unlike the KSeF golden-path S8 which tolerates the #1517 gap.
    const treatment = snapshot.totals.taxTreatment ?? 'inclusive';
    const expectedLines =
      treatment === 'inclusive'
        ? snapshot.items.map((i) => ({ gross: Number(i.price) * i.quantity }))
        : undefined;
    assertInvoiceAmounts(
      {
        currency,
        ...(expectedLines ? { lines: expectedLines } : {}),
        totals: { gross: snapshot.totals.total },
      },
      content,
    );

    testInfo.annotations.push({
      type: 'invoicing',
      description: `inFakt invoice ${cleared.id} accepted (document ${cleared.providerInvoiceNumber ?? '(pending)'}), gross ${content.totals.gross} ${content.currency}`,
    });
  });
});
