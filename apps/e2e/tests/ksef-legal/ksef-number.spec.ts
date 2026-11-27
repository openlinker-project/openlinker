/**
 * ksef-legal: the KSeF number is only ever the authority's (DEF-14)
 *
 * Before KSeF clears a document the panel must not show OpenLinker's own
 * invoice number in the "KSeF number" row (a buyer would quote a number that
 * does not exist in KSeF). Once cleared, the number shown is the one KSeF
 * assigned, in its own format.
 *
 * The pending window is short on KSeF TEST, so the "before" shot is taken
 * immediately after issuing and annotated with what the record held at that
 * moment.
 *
 * @module tests/ksef-legal
 */
import { test, expect } from '../../src/fixtures/test';
import { shot } from '../../src/support/shot';
import { requireKsef, waitForAccepted, ksefOrder } from './ksef-legal.helpers';

/** `{NIP}-{YYYYMMDD}-{12 hex}-{2 hex}`, per the KSeF number format. */
const KSEF_NUMBER = /^\d{10}-\d{8}-[0-9A-F]{12}-[0-9A-F]{2}$/;

test.describe('ksef-legal: KSeF number', () => {
  test('the KSeF number row shows only the number KSeF assigned', async ({
    api,
    world,
    jobs,
    poll,
    pages,
    page,
  }, testInfo) => {
    const ksef = requireKsef(world);
    const synthesized = await ksefOrder({ api, world, jobs, poll });
    const issued = await api.invoices.issue({
      connectionId: ksef.id,
      orderId: synthesized.order.internalOrderId,
    });
    testInfo.annotations.push({
      type: 'right-after-issue',
      description: `regulatory=${issued.regulatoryStatus} clearanceReference=${issued.clearanceReference ?? 'null'}`,
    });

    await pages.ordersList.open(synthesized.order.internalOrderId);
    if (issued.clearanceReference === null) {
      // The row must say "Pending" and must not offer the Art. 108g hint for a
      // number KSeF has not assigned yet.
      await expect(page.getByText('Pending', { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/Art\. 108g/)).toHaveCount(0);
      await shot(page, testInfo, 'ksef-number/01-before-clearance');
    }

    const accepted = await waitForAccepted(
      { api, jobs, poll },
      ksef,
      synthesized.order.internalOrderId
    );
    expect(accepted.regulatoryStatus).toBe('accepted');
    expect(accepted.clearanceReference ?? '').toMatch(KSEF_NUMBER);
    expect(accepted.clearanceReference).not.toBe(accepted.providerInvoiceNumber);

    await page.reload();
    await expect(page.getByText(accepted.clearanceReference!).first()).toBeVisible();
    await expect(page.getByText(/Art\. 108g/)).toBeVisible();
    await shot(page, testInfo, 'ksef-number/02-after-clearance');
  });
});
