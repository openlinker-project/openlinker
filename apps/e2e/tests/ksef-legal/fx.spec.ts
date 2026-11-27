/**
 * ksef-legal: foreign-currency invoices (DEF-07 / DEF-27 / DEF-33)
 *
 * A EUR invoice carries `KursWaluty` on its lines and the VAT in PLN
 * (`P_14_xW`), from the NBP table-A rate of the working day before the sale.
 * Its correction must use the rate of the ORIGINAL's sale date, not the day
 * the correction is made, so the KOR repeats the original's rate.
 *
 * Skipped, with reason, on a shop that has no EUR currency.
 *
 * @module tests/ksef-legal
 */
import { test, expect } from '../../src/fixtures/test';
import { buildPrestashopWebserviceClient } from '../../src/support/order-synthesis';
import {
  BUYER_NIP,
  elementTexts,
  issueAndClear,
  requireKsef,
  waitForRecordCleared,
  ksefOrder,
} from './ksef-legal.helpers';

test.describe('ksef-legal: foreign currency', () => {
  test('a EUR invoice carries the NBP rate, and its correction repeats it', async ({
    api,
    world,
    jobs,
    poll,
  }, testInfo) => {
    const ksef = requireKsef(world);
    const ps = buildPrestashopWebserviceClient(world)!;
    const eurId = await ps.getCurrencyIdByIso('EUR');
    test.skip(!eurId, 'the shop has no EUR currency to denominate an order in (H-05)');

    const synthesized = await ksefOrder(
      { api, world, jobs, poll },
      { currencyId: eurId!, quantity: 2 }
    );
    const accepted = await issueAndClear(
      { api, jobs, poll },
      ksef,
      synthesized.order.internalOrderId,
      {
        buyerTaxId: { scheme: 'pl-nip', value: BUYER_NIP },
      }
    );
    expect(accepted.regulatoryStatus).toBe('accepted');

    const xml = (await api.invoices.getSourceDocumentText(accepted.id)).text;
    expect(elementTexts(xml, 'KodWaluty')).toEqual(['EUR']);
    const rates = elementTexts(xml, 'KursWaluty');
    expect(rates.length, 'a rate on the document').toBeGreaterThan(0);
    expect(Number(rates[0])).toBeGreaterThan(3);
    expect(/<(?:\w+:)?P_14_\d+W>/.test(xml), 'VAT stated in PLN (P_14_xW)').toBe(true);
    testInfo.annotations.push({ type: 'nbp-rate', description: rates[0] });

    const correction = await api.invoices.correct(accepted.id, {
      reason: 'Partial return (e2e, foreign currency)',
      lines: [{ originalLineNumber: 1, newQuantity: 1 }],
    });
    const cleared = await waitForRecordCleared({ api, jobs, poll }, ksef, correction.id);
    testInfo.annotations.push({
      type: 'kor-clearance',
      description: String(cleared.regulatoryStatus),
    });
    expect(cleared.regulatoryStatus).toBe('accepted');
    const korXml = (await api.invoices.getSourceDocumentText(correction.id)).text;
    expect(elementTexts(korXml, 'RodzajFaktury')).toEqual(['KOR']);
    const korRates = elementTexts(korXml, 'KursWaluty');
    expect(korRates.length).toBeGreaterThan(0);
    expect(
      korRates.every((r) => r === rates[0]),
      `KOR rates ${korRates.join(',')} = original ${rates[0]}`
    ).toBe(true);
  });
});
