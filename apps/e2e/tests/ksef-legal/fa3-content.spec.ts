/**
 * ksef-legal: what the operator states about a sale reaches FA(3)
 * (DEF-20 / DEF-29 / DEF-30 / DEF-31)
 *
 * 1. Through the real order panel: the KSeF options for one invoice (split
 *    payment, a GTU marker on the line, a public-sector party) are ticked by
 *    hand, the invoice is issued, and the source XML carries P_18A=1, the GTU
 *    on the line and a Podmiot3 with Rola 8. The FA(3) preview shows them.
 * 2. A public-sector buyer flag with no matching party is not refused: it
 *    asks once (acknowledgement-required), and on confirmation the document
 *    goes to KSeF. Whatever KSeF answers is recorded - that answer is the
 *    evidence for how strict the authority really is (H-07).
 * 3. A margin-scheme sale emits the P_PMarzy group and leaves the per-line VAT
 *    fields off the lines.
 *
 * Unit-only, with reason: an exemption (`zw`) line needs a PrestaShop product
 * whose tax rule maps to `zw`, which this stack's catalogue does not carry
 * (H-13); the P_19A/B/C emission and the placeholder warning are covered by
 * fa3-xml.builder.spec.ts and ksef-invoicing.adapter.spec.ts.
 *
 * @module tests/ksef-legal
 */
import { test, expect } from '../../src/fixtures/test';
import { shot } from '../../src/support/shot';
import {
  elementTexts,
  failureOf,
  hasElement,
  issueAndClear,
  requireKsef,
  waitForAccepted,
  ksefOrder,
} from './ksef-legal.helpers';

const PARTY_NIP = '5260250995';

test.describe('ksef-legal: operator-stated FA(3) content', () => {
  test('KSeF options ticked in the order panel reach the document and its preview', async ({
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
      description: 'zw exemption grounds (P_19A/B/C) need a zw-mapped PS product (H-13)',
    });
    const synthesized = await ksefOrder({ api, world, jobs, poll });

    const detail = await pages.ordersList.open(synthesized.order.internalOrderId);
    await detail.invoice.selectConnection(ksef.name);
    await detail.invoice.openManualOverride();
    const options = detail.invoice.ksefIssueOptions;
    await options.locator(':scope > summary').click();
    await options.getByRole('checkbox', { name: /Split payment/ }).check();
    await options
      .getByRole('combobox', { name: /^GTU for / })
      .first()
      .selectOption('GTU_06');
    await options.getByRole('button', { name: 'Add a party' }).click();
    await options.getByLabel('Name').fill('Gmina Testowo');
    await options.getByLabel('NIP').fill(PARTY_NIP);
    await shot(page, testInfo, 'fa3-content/01-ksef-options-filled');
    await detail.invoice.manualIssueButton.click();

    const accepted = await waitForAccepted(
      { api, jobs, poll },
      ksef,
      synthesized.order.internalOrderId
    );
    testInfo.annotations.push({
      type: 'clearance',
      description: accepted.regulatoryStatus ?? 'null',
    });
    expect(accepted.regulatoryStatus).toBe('accepted');

    const xml = (await api.invoices.getSourceDocumentText(accepted.id)).text;
    expect(elementTexts(xml, 'P_18A')).toEqual(['1']);
    expect(elementTexts(xml, 'GTU')).toContain('GTU_06');
    expect(hasElement(xml, 'Podmiot3'), 'an extra party is emitted').toBe(true);
    expect(elementTexts(xml, 'Rola')).toContain('8');
    expect(elementTexts(xml, 'NIP')).toContain(PARTY_NIP);

    await page.reload();
    await detail.invoice.openFa3Preview();
    await expect(detail.invoice.annotationsList.filter({ hasText: 'Split payment' })).toBeVisible();
    await expect(detail.invoice.annotationsList.filter({ hasText: 'Gmina Testowo' })).toBeVisible();
    await shot(page, testInfo, 'fa3-content/02-fa3-preview-annotations-gtu-podmiot3');
  });

  test('a public-sector flag with no party named asks first, then goes to KSeF', async ({
    api,
    world,
    jobs,
    poll,
  }, testInfo) => {
    const ksef = requireKsef(world);
    const synthesized = await ksefOrder({ api, world, jobs, poll });
    const input = {
      connectionId: ksef.id,
      orderId: synthesized.order.internalOrderId,
      buyerIsPublicSectorEntity: true,
    };

    const refusal = await failureOf(api.invoices.issue(input));
    expect(refusal?.status).toBe(422);
    expect(refusal?.body.failureCode).toBe('acknowledgement-required');
    const code = String(refusal?.body.warningCode ?? '');
    expect(code).not.toBe('');

    await api.invoices.issue({ ...input, acknowledgeWarnings: [code] });
    const outcome = await waitForAccepted(
      { api, jobs, poll },
      ksef,
      synthesized.order.internalOrderId
    );
    // H-07: KSeF's own answer to JST=1 without Podmiot3 is the point of this
    // probe, so it is recorded either way rather than asserted.
    testInfo.annotations.push({
      type: 'ksef-answer-jst-without-podmiot3',
      description: `${outcome.regulatoryStatus}${outcome.failureReason ? `: ${outcome.failureReason}` : ''}`,
    });
    const xml = (await api.invoices.getSourceDocumentText(outcome.id)).text;
    expect(elementTexts(xml, 'JST')).toEqual(['1']);
  });

  test('a margin-scheme sale emits P_PMarzy and keeps per-line VAT off the lines', async ({
    api,
    world,
    jobs,
    poll,
  }, testInfo) => {
    const ksef = requireKsef(world);
    const synthesized = await ksefOrder({ api, world, jobs, poll });
    const accepted = await issueAndClear(
      { api, jobs, poll },
      ksef,
      synthesized.order.internalOrderId,
      {
        annotations: { marginScheme: true, marginKind: 'used-goods' },
      }
    );
    testInfo.annotations.push({
      type: 'clearance',
      description: accepted.regulatoryStatus ?? 'null',
    });
    const xml = (await api.invoices.getSourceDocumentText(accepted.id)).text;
    expect(elementTexts(xml, 'P_PMarzy')).toEqual(['1']);
    expect(hasElement(xml, 'P_PMarzy_3_1'), 'used goods kind').toBe(true);
    expect(hasElement(xml, 'P_13_11'), 'margin total').toBe(true);
    const lines = elementTexts(xml, 'FaWiersz');
    expect(lines.length).toBeGreaterThan(0);
    expect(
      lines.every((line) => !/<(?:\w+:)?P_12>/.test(line)),
      'no per-line rate on a margin line'
    ).toBe(true);
    expect(accepted.regulatoryStatus).toBe('accepted');
  });
});
