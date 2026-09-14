/**
 * eparagony.pl Document Mapper - unit tests (#3187)
 *
 * Focused on `toCreateReceiptRequest`'s handling of the buyer's tax number:
 * it must reach `eReceipt.metadata.consumerTIN` verbatim when the command
 * carries one, and the key must be ABSENT (never an empty string, never
 * `null`) when it does not.
 *
 * @module libs/integrations/eparagony/src/infrastructure/adapters/__tests__
 */
import type { RegisterTransactionCommand } from '@openlinker/core/fiscalization';

import type { EparagonyConnectionConfig } from '../../../domain/types/eparagony-config.types';
import { toCreateReceiptRequest } from '../eparagony-document.mapper';

function makeConfig(overrides: Partial<EparagonyConnectionConfig> = {}): EparagonyConnectionConfig {
  return {
    environment: 'sandbox',
    posId: 'pos-10',
    defaultTaxRateCode: 'A',
    ...overrides,
  };
}

function makeCommand(
  overrides: Partial<RegisterTransactionCommand> = {},
): RegisterTransactionCommand {
  return {
    connectionId: 'conn-eparagony-1',
    orderId: 'ol_order_1',
    idempotencyKey: 'fiscal:conn-eparagony-1:ol_order_1',
    currency: 'PLN',
    lines: [
      { name: 'Red t-shirt', quantity: 2, unitPriceGross: 30.24, taxRate: '', sku: 'SKU-1' },
    ],
    totalGross: 60.48,
    ...overrides,
  };
}

describe('toCreateReceiptRequest — buyer tax number (#3187, ADR-073 decision 1)', () => {
  it('writes the buyer tax number to eReceipt.metadata.consumerTIN, verbatim', () => {
    const request = toCreateReceiptRequest({
      command: makeCommand({ buyerTaxId: '5213796333' }),
      config: makeConfig(),
      documentToken: 'doc-1',
      transactionToken: 'txn-1',
    });

    expect(request.eReceipt.metadata.consumerTIN).toBe('5213796333');
  });

  it('omits the key for a WHITESPACE-only value rather than sending blanks (#3220 review)', () => {
    // A blank column decodes to the blank string rather than to `null`
    // upstream, so without a trim here a real fiscal document would carry
    // `consumerTIN: "   "`. Trimming is not normalisation: what survives is
    // still sent verbatim.
    const request = toCreateReceiptRequest({
      command: makeCommand({ buyerTaxId: '   ' }),
      config: makeConfig(),
      documentToken: 'doc-1',
      transactionToken: 'txn-1',
    });

    expect(request.eReceipt.metadata.consumerTIN).toBeUndefined();
  });

  it('sends the value with NO validation, normalisation or format check', () => {
    // ADR-073 decision 5: core never pre-judges which numbers a provider will
    // accept. A malformed-looking value is passed through exactly as given —
    // the vendor's own regex is the only judge, and its refusal surfaces as an
    // ordinary EparagonyApiError from the create call, never from this mapper.
    const request = toCreateReceiptRequest({
      command: makeCommand({ buyerTaxId: '5213796ZZZ' }),
      config: makeConfig(),
      documentToken: 'doc-1',
      transactionToken: 'txn-1',
    });

    expect(request.eReceipt.metadata.consumerTIN).toBe('5213796ZZZ');
  });

  it('omits consumerTIN entirely — never an empty string, never null — when the order carries no buyer tax id', () => {
    // Pinning test (#3187 scope item 3). Both "asserted none" and "not
    // asserted" reach this mapper as an absent `command.buyerTaxId`, and the
    // request must OMIT the key rather than send an empty/null value: the
    // vendor's field is optional and regex-validated with no defined meaning
    // for blank, so a value we cannot support is a value we must not send.
    // The silence here is deliberate, not an oversight — this test is what
    // makes that a checked property rather than a comment.
    const request = toCreateReceiptRequest({
      command: makeCommand(),
      config: makeConfig(),
      documentToken: 'doc-1',
      transactionToken: 'txn-1',
    });

    expect(request.eReceipt.metadata.consumerTIN).toBeUndefined();
    expect('consumerTIN' in request.eReceipt.metadata).toBe(false);
  });

  it('omits consumerTIN when the command carries an empty string', () => {
    // Defensive: `RegisterTransactionCommand.buyerTaxId` is typed `string`, not
    // guaranteed non-empty by this adapter's own type system — the
    // fiscalization mapper never emits one, but a malformed caller must not
    // reach the vendor with a blank tax field either.
    const request = toCreateReceiptRequest({
      command: makeCommand({ buyerTaxId: '' }),
      config: makeConfig(),
      documentToken: 'doc-1',
      transactionToken: 'txn-1',
    });

    expect('consumerTIN' in request.eReceipt.metadata).toBe(false);
  });
});
