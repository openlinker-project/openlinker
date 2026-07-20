/**
 * Invoicing: correction (KOR) and correction-of-correction (#1573, scenario 4)
 *
 * Issues a B2B KSeF invoice, corrects it (quantity delta), then corrects the
 * CORRECTION itself, and asserts the second correction is built from the
 * FIRST correction's own issuance-time snapshot — not the order's current
 * state (#1297).
 *
 * Ground-truth verification (read directly, not paraphrased from the issue):
 * `InvoicingController.issueCorrection` (`apps/api/src/invoicing/http/invoicing.controller.ts`,
 * ~line 730) resolves `original = getInvoiceById(:invoiceId)` — for a
 * correction-of-correction, `:invoiceId` is the FIRST correction's own id, so
 * `original` IS that correction, not the root invoice. It then branches:
 *   `if (original.issuedLineSnapshot) { originalDocument =
 *   buildSnapshotFromRecord(original, original.issuedLineSnapshot) }`
 * and only falls back to rebuilding from the order's CURRENT state when no
 * snapshot exists. `InvoiceService.issueInvoice`
 * (`libs/core/src/invoicing/application/services/invoice.service.ts`, ~line
 * 375-412) persists a fresh `issuedLineSnapshot` on EVERY issuance, including a
 * correction's own outcome (~line 556-598) — so the first correction carries
 * its OWN post-correction `{buyer, currency, lines}` snapshot, and the second
 * correction diffs its deltas against THAT, never against the order's
 * (unchanged) original lines.
 *
 * This is asserted observably, not just re-stated from the code read: the
 * buyer tax id is the differentiator. The pre-#1297 order-derived fallback
 * path explicitly sets `buyerTaxId: null` on the rebuilt document (same
 * controller, the `else` branch) — so if the correction-of-correction were
 * (incorrectly) built from the order instead of the first correction's own
 * snapshot, `content.buyer.taxId` would come back `null`. Issuing the ORIGINAL
 * invoice as B2B (a real tax id) and asserting the tax id survives BOTH
 * corrections is a real, deterministic proof that the snapshot path — not the
 * order-fallback path — was used both times.
 *
 * @module tests/invoicing
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import { synthesizeOrder, buildPrestashopWebserviceClient } from '../../src/support/order-synthesis';

const BUYER_TAX_ID = { scheme: 'pl-nip', value: '1234567890' };

test.describe('invoicing: correction (KOR) and correction-of-correction', () => {
  test('a correction-of-correction diffs against the first correction\'s own snapshot', async ({
    api,
    world,
    jobs,
    poll,
  }, testInfo) => {
    const ksef = world.connectionFor(PlatformType.ksef);
    test.skip(!ksef, 'no KSeF connection on this stack');
    test.skip(
      !buildPrestashopWebserviceClient(world),
      'OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL) is required to synthesize an order',
    );

    // Quantity 3 so the first correction has room to reduce it, and the
    // correction-of-correction can reduce it again without going negative.
    const synthesized = await synthesizeOrder({ api, world, jobs, poll }, { quantity: 3 });

    await api.invoices.issue({
      connectionId: ksef!.id,
      orderId: synthesized.order.internalOrderId,
      buyerTaxId: BUYER_TAX_ID,
    });
    const original = await poll.until(
      () => api.invoices.getForOrder(synthesized.order.internalOrderId, ksef!.id),
      (r) => r.status === 'issued' && !!r.providerInvoiceId && !!r.providerInvoiceNumber,
      { message: 'KSeF invoice to be issued with a document number', timeoutMs: 60_000 },
    );

    const firstCorrection = await api.invoices.correct(original.id, {
      reason: 'Quantity adjustment (E2E #1573 scenario 4)',
      lines: [{ originalLineNumber: 1, newQuantity: 2 }],
    });
    expect(firstCorrection.id).not.toBe(original.id);
    const firstContent = await api.invoices.getContent(firstCorrection.id);
    expect(firstContent.lines[0]?.quantity, 'first correction reduces quantity to 2').toBe(2);
    expect(
      firstContent.buyer.taxId?.value,
      'first correction preserves the B2B buyer tax id',
    ).toBe(BUYER_TAX_ID.value);

    const secondCorrection = await api.invoices.correct(firstCorrection.id, {
      reason: 'Further quantity adjustment (E2E #1573 scenario 4, correction-of-correction)',
      lines: [{ originalLineNumber: 1, newQuantity: 1 }],
    });
    expect(secondCorrection.id).not.toBe(firstCorrection.id);
    const secondContent = await api.invoices.getContent(secondCorrection.id);
    expect(secondContent.lines[0]?.quantity, 'second correction reduces quantity to 1').toBe(1);

    // The load-bearing assertion (#1297): if the second correction had been
    // rebuilt from the ORDER's current state (the pre-#1297 fallback) instead
    // of the first correction's own `issuedLineSnapshot`, `buyerTaxId` would be
    // explicitly nulled (`buildOriginalDocumentSnapshot`'s `buyerTaxId: null`).
    // Its presence here proves the snapshot-based path fired.
    expect(
      secondContent.buyer.taxId?.value,
      'correction-of-correction preserves the B2B buyer tax id from the FIRST correction\'s ' +
        'own snapshot, proving it did not fall back to order-derived reconstruction',
    ).toBe(BUYER_TAX_ID.value);

    testInfo.annotations.push({
      type: 'invoicing',
      description: `original ${original.id} -> correction ${firstCorrection.id} -> correction-of-correction ${secondCorrection.id}`,
    });
  });
});
