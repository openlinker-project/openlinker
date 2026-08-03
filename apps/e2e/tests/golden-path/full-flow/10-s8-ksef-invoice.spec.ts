/**
 * Golden path full-flow: S8 — KSeF invoice
 *
 * Issue, reconcile to accepted, then assert number, UPO and FA(3) XML.
 *
 * Segment of the attended S0-S9 flow across all six systems. The segments share
 * `state` and run in file order in one worker — see `./segment.ts` for the
 * ordering, fail-fast and attended-gate contract, and
 * `docs/manual-testing/e2e-golden-path.md` for the flow itself.
 *
 * WARNING: MUTATING and ATTENDED. Run only via
 * `pnpm --filter @openlinker/e2e test:e2e:full-flow`, in a coordinated session
 * against a stack you control.
 *
 * @module tests/golden-path/full-flow
 */
import { test, expect } from '../../../src/fixtures/test';
import { PlatformType } from '../../../src/world/world';
import { manualCheckpoint } from '../../../src/support/manual-checkpoint';
import { assertInvoiceAmounts, toMinorUnits } from '../../../src/support/parity';
import { state } from './flow-state';
import { fullFlowSegment } from './segment';
import { requireOrder, readOrderSnapshot } from './helpers';

fullFlowSegment(() => {
  test('S8 — KSeF: issue → reconcile → accepted, number, UPO, FA(3) XML', async ({ api, world, jobs, poll }) => {
    const testInfo = test.info();
    requireOrder();
    const ksef = world.connectionFor(PlatformType.ksef);
    test.skip(!ksef, 'no KSeF connection on this stack');

    // Issue one invoice per marketplace order via POST /invoices (the server
    // assembles lines/buyer from the order). Idempotent — reuse if already issued.
    for (const [platform, order] of state.orders) {
      let invoice = await api.invoices.getForOrder(order.internalOrderId, ksef!.id).catch(() => null);
      if (!invoice) {
        await api.invoices.issue({
          connectionId: ksef!.id,
          orderId: order.internalOrderId,
        });
        invoice = await poll.until(
          () => api.invoices.getForOrder(order.internalOrderId, ksef!.id),
          (r) => r.status === 'issued' || r.status === 'issuing',
          { message: `invoice to be issued (${platform} order)`, timeoutMs: 180_000 },
        );
      }
      state.invoiceIds.set(platform, invoice.id);
    }

    // Reconcile clearance until accepted with a KSeF number. The reconcile
    // handler is schema-strict: it throws (job retries to dead) unless the
    // payload carries `schemaVersion: 1`. KSeF clearance is asynchronous and a
    // single reconcile pass right after issue routinely runs BEFORE the
    // authority clears the document, so re-trigger the (idempotent) reconcile
    // on every poll iteration instead of relying on the 30-minute cron.
    const invoiceSummaries: string[] = [];
    for (const [platform, order] of state.orders) {
      const invoiceId = state.invoiceIds.get(platform)!;
      const cleared = await poll.until(
        async () => {
          await jobs
            .trigger({
              connectionId: ksef!.id,
              jobType: 'invoicing.regulatoryStatus.reconcile',
              payload: { schemaVersion: 1 },
            })
            .catch(() => undefined);
          return api.invoices.getById(invoiceId);
        },
        (r) => r.regulatoryStatus === 'accepted' && !!r.clearanceReference,
        { message: `invoice to reach accepted + KSeF number (${platform})`, timeoutMs: 300_000, intervalMs: 10_000 },
      );
      expect(cleared.clearanceReference, `KSeF number (${platform})`).toBeTruthy();
      expect(cleared.documentType, `invoice document type recorded (${platform})`).toBeTruthy();

      // Amount parity: expected per-line gross derived from the ORDER snapshot
      // (buyer-paid price × qty) — matched by gross containment. Totals gross
      // should equal the order total, but the invoice currently omits the
      // order's shipping line (#1517, OPEN) — when the mismatch is EXACTLY the
      // shipping amount, annotate the known gap and still assert the item
      // lines; any other mismatch fails.
      const content = await api.invoices.getContent(invoiceId);
      const snapshot = readOrderSnapshot(order);
      const currency = snapshot.totals.currency;
      const treatment = snapshot.totals.taxTreatment ?? 'inclusive';
      const expectedLines =
        treatment === 'inclusive'
          ? snapshot.items.map((i) => ({ gross: Number(i.price) * i.quantity }))
          : undefined; // exclusive line prices are net — gross per line is not derivable here
      const shippingMinor = toMinorUnits(snapshot.totals.shipping ?? 0, currency);
      const grossGapMinor =
        toMinorUnits(snapshot.totals.total, currency) - toMinorUnits(content.totals.gross, currency);
      if (shippingMinor > 0 && grossGapMinor === shippingMinor) {
        testInfo.annotations.push({
          type: 'known-gap',
          description:
            `#1517 (${platform}): invoice gross ${content.totals.gross} omits the order shipping ` +
            `${snapshot.totals.shipping} (order total ${snapshot.totals.total})`,
        });
        assertInvoiceAmounts(
          { currency, ...(expectedLines ? { lines: expectedLines } : {}) },
          content,
        );
      } else {
        assertInvoiceAmounts(
          {
            currency,
            ...(expectedLines ? { lines: expectedLines } : {}),
            totals: { gross: snapshot.totals.total },
          },
          content,
        );
      }
      expect(content.lines.length, `invoice has lines (${platform})`).toBeGreaterThan(0);

      // UPO + source FA(3) XML retrievable.
      const upo = await api.invoices.getUpo(invoiceId);
      expect(upo.ok && upo.byteLength > 0, `UPO retrievable (${platform})`).toBe(true);
      const xml = await api.invoices.getSourceDocument(invoiceId);
      expect(xml.ok && xml.byteLength > 0, `FA(3) source XML retrievable (${platform})`).toBe(true);

      invoiceSummaries.push(
        `${platform}: ${cleared.clearanceReference} (${cleared.documentType}, gross ${content.totals.gross} ${content.currency})`,
      );
    }

    await manualCheckpoint(testInfo, {
      dashboard: 'KSeF test environment',
      expect: ['Each invoice is visible with its KSeF number below', 'Amounts (net/VAT/gross) match the orders'],
      values: { invoices: invoiceSummaries.join(' | ') },
    });
  });
});
