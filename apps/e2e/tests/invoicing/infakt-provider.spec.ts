/**
 * Invoicing: inFakt provider run (#1573, scenario 1)
 *
 * Unattended counterpart to the golden path's S8 (KSeF-only). Issues an
 * invoice on the inFakt connection for a REST-synthesized order (no
 * marketplace purchase — `synthesizeOrder` creates the order directly against
 * PrestaShop's webservice, which is a real `OrderSourcePort`), reconciles
 * clearance to `accepted`, and asserts matching per-line and total amounts
 * (reusing `assertInvoiceAmounts` the same way the golden path's S8 does for
 * KSeF).
 *
 * The SHIPPING LINE (#1567) is NOT covered here, despite what an earlier
 * version of this doc and the test's name claimed. A synthesized order always
 * reaches OL with `totals.shipping === 0` (PrestaShop's raw webservice zeroes
 * `total_shipping*`, #503/#898 - verified live), so the shipping-line branch is
 * DEAD on this path and the test passed while asserting nothing about it. Real
 * coverage needs an order created through `validateOrder` (the OL module's
 * `importorder` endpoint), i.e. the attended full-flow's marketplace purchase.
 *
 * Self-configuring: skips with a clear reason when the stack has no inFakt
 * connection or no PrestaShop webservice key (order synthesis requires it).
 *
 * @module tests/invoicing
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import { synthesizeOrder, buildPrestashopWebserviceClient } from '../../src/support/order-synthesis';
import { narrowOrderSnapshot } from '../../src/support/order-snapshot';
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
  test('issues via inFakt, reconciles to accepted, and matches the order amounts', async ({
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
    const snapshot = narrowOrderSnapshot<OrderSnapshotShape>(order);
    const currency = snapshot.totals.currency;

    // Shipping line (#1567): when the INGESTED order carries shipping, the
    // mapper's `toShippingLine` must append a line whose gross matches it.
    //
    // FIXME(#1567 coverage): on THIS path the `> 0` branch is unreachable, so
    // nothing below is real coverage. PrestaShop's raw webservice
    // `POST /api/orders` resets `total_shipping` to 0 no matter what the request
    // or its cart carries (#503/#898 — see `SynthesizeOrderOptions
    // .shippingTaxIncl`), verified live, so a synthesized order ALWAYS reaches
    // OL with zero shipping and there is nothing for the mapper to render.
    // Asserting a positive amount here would be asserting against the source
    // platform, not against OL. The branch is kept (rather than deleted) so it
    // starts working the moment order synthesis moves to `validateOrder` via the
    // OL module's `importorder` endpoint; until then the real coverage lives in
    // the attended full-flow's marketplace purchase.
    const shippingMinor = toMinorUnits(snapshot.totals.shipping ?? 0, currency);
    if (shippingMinor > 0) {
      const shippingLine = content.lines.find(
        (l) => toMinorUnits(l.gross, currency) === shippingMinor,
      );
      expect(shippingLine, 'invoice carries a line matching the order shipping amount').toBeTruthy();
    } else {
      testInfo.annotations.push({
        type: 'invoicing',
        description:
          'shipping line NOT asserted (expected on this path, not an anomaly) - PrestaShop zeroes ' +
          'a raw-webservice order\'s shipping (#503/#898), so #1567 has no coverage here; see the ' +
          'attended full-flow for the real thing',
      });
    }

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
