/**
 * ksef-legal: corrections (DEF-08 / DEF-10 / DEF-23 / DEF-24 / DEF-25 / DEF-32 / DEF-38)
 *
 * - The reason is recommended, not forced: the form warns once, the API takes
 *   a correction without one and KSeF clears it with no empty
 *   `<PrzyczynaKorekty/>`. A reason over 256 characters is refused, in the
 *   form and at the API.
 * - A buyer-only correction (no line changes) is `TypKorekty 1`, carries no
 *   `FaWiersz`, and names the buyer as it was in `Podmiot2K`.
 * - Changing the buyer's NIP asks first (MF guidance is usually to correct to
 *   zero and reissue); confirmed, it is issued.
 * - The same idempotency key returns the same correction (DEF-10).
 *
 * Unit-only, with reason: the refused buyer override on a provider that cannot
 * carry one (inFakt, eparagony, DEF-09) needs those connections live, which
 * this KSeF-only stack does not run; invoice.service.spec.ts covers it.
 *
 * @module tests/ksef-legal
 */
import { test, expect } from '../../src/fixtures/test';
import { shot } from '../../src/support/shot';
import {
  BUYER_NIP,
  elementTexts,
  failureOf,
  hasElement,
  issueAndClear,
  requireKsef,
  waitForRecordCleared,
  ksefOrder,
} from './ksef-legal.helpers';

const OTHER_NIP = '5260250995';

const buyer = (name: string, nip: string) => ({
  name,
  taxId: { scheme: 'pl-nip', value: nip },
  address: { line1: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-001', countryIso2: 'PL' },
  type: 'company' as const,
});

test.describe('ksef-legal: corrections', () => {
  test('the reason field suggests a reason, caps it, and the API accepts none', async ({
    api,
    world,
    jobs,
    poll,
    pages,
    page,
  }, testInfo) => {
    const ksef = requireKsef(world);
    testInfo.annotations.push({
      type: 'unit-only',
      description: 'refused buyer override on inFakt / eparagony (DEF-09): invoice.service.spec.ts',
    });
    const synthesized = await ksefOrder({ api, world, jobs, poll }, { quantity: 3 });
    const original = await issueAndClear(
      { api, jobs, poll },
      ksef,
      synthesized.order.internalOrderId,
      {
        buyerTaxId: { scheme: 'pl-nip', value: BUYER_NIP },
      }
    );
    expect(original.regulatoryStatus).toBe('accepted');

    // The form, without submitting anything.
    await pages.ordersList.open(synthesized.order.internalOrderId);
    await page.locator('.sales-document-panel__correction > summary').click();
    await page
      .locator('.sales-document-panel__correction')
      .getByRole('button', { name: 'Issue correction' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Issue correction' });
    await expect(dialog.getByText('(recommended)')).toBeVisible();
    await expect(dialog.getByText('0 / 256')).toBeVisible();
    await shot(page, testInfo, 'corrections/01-reason-field-recommended');
    await dialog.getByLabel(/Reason for correction/).fill('x'.repeat(257));
    await expect(dialog.getByText(/at most 256 characters/)).toBeVisible();
    await shot(page, testInfo, 'corrections/02-reason-over-cap');
    await page.keyboard.press('Escape');

    // The API: too long is refused, none is accepted and cleared.
    const tooLong = await failureOf(
      api.invoices.correct(original.id, {
        reason: 'x'.repeat(257),
        lines: [{ originalLineNumber: 1, newQuantity: 2 }],
      })
    );
    expect(tooLong?.status).toBe(400);

    const korNoReason = await api.invoices.correct(original.id, {
      lines: [{ originalLineNumber: 1, newQuantity: 2 }],
    });
    const cleared = await waitForRecordCleared({ api, jobs, poll }, ksef, korNoReason.id);
    expect(cleared.regulatoryStatus).toBe('accepted');
    const xml = (await api.invoices.getSourceDocumentText(korNoReason.id)).text;
    expect(hasElement(xml, 'PrzyczynaKorekty'), 'no empty reason element').toBe(false);
  });

  test('a buyer-only correction is TypKorekty 1 with the old buyer in Podmiot2K', async ({
    api,
    world,
    jobs,
    poll,
  }) => {
    const ksef = requireKsef(world);
    const synthesized = await ksefOrder({ api, world, jobs, poll });
    const original = await issueAndClear(
      { api, jobs, poll },
      ksef,
      synthesized.order.internalOrderId,
      {
        buyerTaxId: { scheme: 'pl-nip', value: BUYER_NIP },
      }
    );
    expect(original.regulatoryStatus).toBe('accepted');

    const idempotencyKey = `e2e-buyer-only-${original.id}`;
    const input = {
      reason: 'Corrected buyer name',
      lines: [],
      idempotencyKey,
      buyerOverride: buyer('Testowa Firma Poprawiona Sp. z o.o.', BUYER_NIP),
    };
    const kor = await api.invoices.correct(original.id, input);
    const again = await api.invoices.correct(original.id, input);
    expect(again.id, 'the same key returns the same correction (DEF-10)').toBe(kor.id);

    const cleared = await waitForRecordCleared({ api, jobs, poll }, ksef, kor.id);
    expect(cleared.regulatoryStatus).toBe('accepted');
    const xml = (await api.invoices.getSourceDocumentText(kor.id)).text;
    expect(elementTexts(xml, 'TypKorekty')).toEqual(['1']);
    expect(hasElement(xml, 'FaWiersz'), 'no line rows on a buyer-only KOR').toBe(false);
    expect(hasElement(xml, 'Podmiot2K'), 'the buyer as it was').toBe(true);
    const order = xml.indexOf('DaneFaKorygowanej');
    expect(order).toBeGreaterThan(-1);
    expect(xml.indexOf('Podmiot2K')).toBeGreaterThan(order);
  });

  test('changing the buyer NIP asks first, and issues once confirmed', async ({
    api,
    world,
    jobs,
    poll,
  }, testInfo) => {
    const ksef = requireKsef(world);
    const synthesized = await ksefOrder({ api, world, jobs, poll });
    const original = await issueAndClear(
      { api, jobs, poll },
      ksef,
      synthesized.order.internalOrderId,
      {
        buyerTaxId: { scheme: 'pl-nip', value: BUYER_NIP },
      }
    );
    expect(original.regulatoryStatus).toBe('accepted');

    const input = {
      reason: 'Invoice issued to the wrong company',
      lines: [],
      idempotencyKey: `e2e-nip-change-${original.id}`,
      buyerOverride: buyer('Inna Firma Sp. z o.o.', OTHER_NIP),
    };
    const refusal = await failureOf(api.invoices.correct(original.id, input));
    expect(refusal?.status).toBe(422);
    expect(refusal?.body.failureCode).toBe('acknowledgement-required');
    expect(refusal?.body.warningCode).toBe('ksef-buyer-tax-id-change');
    testInfo.annotations.push({
      type: 'warning-sentence',
      description: String(refusal?.body.message ?? ''),
    });

    const kor = await api.invoices.correct(original.id, {
      ...input,
      acknowledgeWarnings: ['ksef-buyer-tax-id-change'],
    });
    const cleared = await waitForRecordCleared({ api, jobs, poll }, ksef, kor.id);
    testInfo.annotations.push({
      type: 'ksef-answer-nip-change',
      description: `${cleared.regulatoryStatus}${cleared.failureReason ? `: ${cleared.failureReason}` : ''}`,
    });
    const xml = (await api.invoices.getSourceDocumentText(kor.id)).text;
    expect(elementTexts(xml, 'NIP')).toContain(OTHER_NIP);
    expect(hasElement(xml, 'Podmiot2K')).toBe(true);
  });
});
