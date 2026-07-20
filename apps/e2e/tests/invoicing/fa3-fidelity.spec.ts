/**
 * Invoicing: FA(3) field parity + rebuilt preview (#1573, scenarios 5 + 6)
 *
 * Scenario 5 extends the golden path's S8 source-XML assertions (which only
 * check byte-length) with real field-level checks: the source FA(3) XML
 * carries `P_6` (sale date), `P_8A` (unit of measure), and `P_9A` (net unit
 * price) — the fields `fa3-xml.builder.ts` emits (#1529). Element lookup is
 * namespace-prefix tolerant (`(?:\w+:)?P_6`), mirroring the FE's own
 * `collectByLocalName` approach to the same document.
 *
 * Scenario 6 drives the rebuilt FA(3) preview (#1528): `KsefInvoiceDetailSection`
 * renders a "View" action (gated on `regulatoryStatus === 'accepted'`) that
 * loads the source XML client-side and renders `KsefFa3View` into
 * `.doc-preview` — asserted structurally (a real `<table class="ksef-fa3-view__table">`
 * with one row per invoice line), not pixel comparison.
 *
 * @module tests/invoicing
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import { synthesizeOrder, buildPrestashopWebserviceClient } from '../../src/support/order-synthesis';

/** Namespace-prefix tolerant element-presence check (mirrors the FE's `collectByLocalName`). */
function hasElement(xml: string, localName: string): boolean {
  return new RegExp(`<(?:\\w+:)?${localName}>`).test(xml);
}

test.describe('invoicing: FA(3) field parity + preview', () => {
  test('source FA(3) XML carries P_6 / P_8A / P_9A, and the rebuilt preview renders structurally', async ({
    api,
    world,
    jobs,
    poll,
    pages,
  }, testInfo) => {
    const ksef = world.connectionFor(PlatformType.ksef);
    test.skip(!ksef, 'no KSeF connection on this stack');
    test.skip(
      !buildPrestashopWebserviceClient(world),
      'OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL) is required to synthesize an order',
    );

    const synthesized = await synthesizeOrder({ api, world, jobs, poll });
    await api.invoices.issue({ connectionId: ksef!.id, orderId: synthesized.order.internalOrderId });
    const accepted = await poll.until(
      async () => {
        await jobs
          .trigger({
            connectionId: ksef!.id,
            jobType: 'invoicing.regulatoryStatus.reconcile',
            payload: { schemaVersion: 1 },
          })
          .catch(() => undefined);
        return api.invoices.getForOrder(synthesized.order.internalOrderId, ksef!.id);
      },
      (r) => r.regulatoryStatus === 'accepted',
      { message: 'KSeF invoice to reach accepted', timeoutMs: 300_000, intervalMs: 10_000 },
    );

    // Scenario 5: field-level FA(3) source-XML parity.
    const xml = await api.invoices.getSourceDocumentText(accepted.id);
    expect(xml.ok && xml.byteLength > 0, 'FA(3) source XML retrievable').toBe(true);
    expect(hasElement(xml.text, 'P_6'), 'FA(3) XML carries P_6 (sale date)').toBe(true);
    expect(hasElement(xml.text, 'P_9A'), 'FA(3) XML carries P_9A (net unit price)').toBe(true);
    // P_8A (unit) is only emitted when the line carries a unit — marketplace
    // order lines carry no unit (`order-to-issue-invoice-command.mapper.ts`
    // doc), so this is annotated rather than asserted when absent.
    if (hasElement(xml.text, 'P_8A')) {
      testInfo.annotations.push({ type: 'fa3-fields', description: 'P_8A (unit) present' });
    } else {
      testInfo.annotations.push({
        type: 'fa3-fields',
        description: 'P_8A (unit) absent — the synthesized order line carries no unit of measure (expected)',
      });
    }

    // Scenario 6: the rebuilt FA(3) preview, driven for real in the browser.
    const content = await api.invoices.getContent(accepted.id);
    const orderDetail = await pages.ordersList.open(synthesized.order.internalOrderId);
    await orderDetail.invoice.openFa3Preview();
    const rows = orderDetail.invoice.fa3LineItemsTable.first().locator('tbody tr');
    await expect(rows).toHaveCount(content.lines.length);
  });
});
