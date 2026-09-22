/**
 * eparagony.pl Corrective Invoice Mapper - unit tests (#3193)
 *
 * `composeCorrectiveInvoiceDocument` composes the vendor's `eCorrectiveInvoice`
 * document kind from an `IssueCorrectionCommand` plus its caller-assembled
 * `originalDocument` snapshot. These tests pin the wire contract:
 * `correctedMetadata` links the correction to the original BY INVOICE NUMBER,
 * `correctingMetadata` states the post-correction totals and REQUIRES the full
 * seller identity (unlike a plain invoice, where the name and address are
 * optional), and `metadata.invoiceNumber` is the correction's OWN number.
 *
 * @module libs/integrations/eparagony/src/infrastructure/adapters/__tests__
 */
import { BuyerProfile } from '@openlinker/core/invoicing';
import type {
  BuyerAddress,
  CorrectionLine,
  InvoiceLine,
  IssueCorrectionCommand,
  OriginalDocumentSnapshot,
  TaxIdentifier,
} from '@openlinker/core/invoicing';

import { EparagonyConfigException } from '../../../domain/exceptions/eparagony-config.exception';
import type {
  EparagonyConnectionConfig,
  EparagonySellerAddress,
} from '../../../domain/types/eparagony-config.types';
import { composeCorrectiveInvoiceDocument } from '../eparagony-invoice.mapper';

const CONNECTION_ID = 'conn-eparagony-1';
const DOCUMENT_TOKEN = '03f75ffc-4808-4135-b8fe-b79451c1245f';
const TRANSACTION_TOKEN = 'b09421b0-5425-4a96-9bff-c0236634bb8b';

const SELLER_ADDRESS: EparagonySellerAddress = {
  street: 'ul. Grzybowska',
  number: '2',
  postalCode: '00-131',
  city: 'Warszawa',
  country: 'PL',
};

function makeConfig(overrides: Partial<EparagonyConnectionConfig> = {}): EparagonyConnectionConfig {
  return {
    environment: 'sandbox',
    posId: 'openlinker',
    merchantTIN: '5252556107',
    merchantName: 'OpenLinker POC Sp. z o.o.',
    merchantAddress: SELLER_ADDRESS,
    ...overrides,
  };
}

function makeAddress(overrides: Partial<BuyerAddress> = {}): BuyerAddress {
  return {
    line1: 'Pl. Obroncow Lublina 73',
    line2: null,
    city: 'Warszawa',
    postalCode: '20-601',
    countryIso2: 'PL',
    ...overrides,
  };
}

function makeBuyer(taxId: TaxIdentifier | null = null, address = makeAddress()): BuyerProfile {
  return new BuyerProfile(
    'Firma Polska sc.',
    taxId,
    address,
    taxId === null ? 'private' : 'company',
  );
}

function makeOriginalLines(): InvoiceLine[] {
  return [{ name: 'T-shirt', quantity: 2, unitPriceGross: 49.2, taxRate: '23' }];
}

function makeOriginalDocument(
  overrides: Partial<OriginalDocumentSnapshot> = {},
): OriginalDocumentSnapshot {
  return {
    buyer: makeBuyer(),
    currency: 'PLN',
    documentType: 'invoice',
    lines: makeOriginalLines(),
    clearanceReference: '5265877635-20250626-010080DD2B5E-26',
    documentNumber: 'OL-POC/2026/B2B/1',
    issueDate: '2026-09-15',
    ...overrides,
  };
}

function makeCorrectionLines(): CorrectionLine[] {
  return [{ originalLineNumber: 1, newQuantity: 1 }];
}

function makeCommand(overrides: Partial<IssueCorrectionCommand> = {}): IssueCorrectionCommand {
  return {
    connectionId: CONNECTION_ID,
    orderId: 'ol_order_1',
    originalProviderInvoiceId: DOCUMENT_TOKEN,
    reason: 'buyer returned one unit',
    lines: makeCorrectionLines(),
    idempotencyKey: `correction:${CONNECTION_ID}:ol_order_1`,
    originalDocument: makeOriginalDocument(),
    ...overrides,
  };
}

function composeDocument(
  command: IssueCorrectionCommand = makeCommand(),
  config: EparagonyConnectionConfig = makeConfig(),
): ReturnType<typeof composeCorrectiveInvoiceDocument> {
  return composeCorrectiveInvoiceDocument({
    command,
    config,
    documentToken: DOCUMENT_TOKEN,
    transactionToken: TRANSACTION_TOKEN,
  });
}

function compose(
  command: IssueCorrectionCommand = makeCommand(),
  config: EparagonyConnectionConfig = makeConfig(),
): ReturnType<typeof composeCorrectiveInvoiceDocument>['request'] {
  return composeDocument(command, config).request;
}

describe('composeCorrectiveInvoiceDocument - the wire shape', () => {
  it('should send the correction under the caller-supplied token pair and pos id', () => {
    const request = compose();
    expect(request.posId).toBe('openlinker');
    expect(request.documentToken).toBe(DOCUMENT_TOKEN);
    expect(request.transactionToken).toBe(TRANSACTION_TOKEN);
  });

  it('should compose correctedMetadata from the original snapshot, linked by invoice number', () => {
    const { eCorrectiveInvoice } = compose();

    expect(eCorrectiveInvoice.invoiceType).toBe('VAT');
    expect(eCorrectiveInvoice.correctedMetadata).toEqual({
      invoiceNumber: 'OL-POC/2026/B2B/1',
      invoiceDate: '2026-09-15',
      // The ORIGINAL total: 2 units at 49.20 gross = 9840 minor units.
      grossSaleValue: 9840,
    });
  });

  it('should compose correctingMetadata from the corrected totals with the full seller identity', () => {
    const { eCorrectiveInvoice } = compose();

    expect(eCorrectiveInvoice.correctingMetadata).toEqual({
      merchantTIN: '5252556107',
      merchantName: 'OpenLinker POC Sp. z o.o.',
      merchantAddress: {
        street: 'ul. Grzybowska',
        number: '2',
        postalCode: '00-131',
        city: 'Warszawa',
        country: 'PL',
      },
      consumerName: 'Firma Polska sc.',
      consumerAddress: {
        street: 'Pl. Obroncow Lublina',
        number: '73',
        postalCode: '20-601',
        city: 'Warszawa',
        country: 'PL',
      },
      // The CORRECTED total: 1 unit at 49.20 gross = 4920 minor units.
      grossSaleValue: 4920,
    });
  });

  it("should state the CORRECTED per-rate summary on the correction's own metadata", () => {
    const { eCorrectiveInvoice } = compose();

    expect(eCorrectiveInvoice.metadata.grossSaleValue).toBe(4920);
    expect(eCorrectiveInvoice.metadata.netValueByTaxRate).toEqual({ '23': 4000 });
    expect(eCorrectiveInvoice.metadata.taxValueByTaxRate).toEqual({ '23': 920 });
    expect(eCorrectiveInvoice.metadata.currency).toBe('PLN');
    expect(eCorrectiveInvoice.metadata.orderId).toBe('ol_order_1');
  });

  it("should stamp the correction's OWN new number onto metadata.invoiceNumber", () => {
    const { eCorrectiveInvoice } = compose(makeCommand({ documentNumber: 'OL-POC/2026/KOR/1' }));

    expect(eCorrectiveInvoice.metadata.invoiceNumber).toBe('OL-POC/2026/KOR/1');
    // The original's number lives only on `correctedMetadata`.
    expect(eCorrectiveInvoice.correctedMetadata.invoiceNumber).toBe('OL-POC/2026/B2B/1');
  });

  it('should omit metadata.invoiceNumber when core allocated none, so the vendor generates one', () => {
    const { eCorrectiveInvoice } = compose();
    expect('invoiceNumber' in eCorrectiveInvoice.metadata).toBe(false);
  });

  it("should stamp the correction's own issue date from the command's issuance instant", () => {
    const { eCorrectiveInvoice } = compose(
      makeCommand({ issuedAt: new Date('2026-09-20T09:00:00.000Z') }),
    );
    expect(eCorrectiveInvoice.metadata.invoiceDate).toBe('2026-09-20');
    // Never confused with the ORIGINAL's date, which the linkage carries.
    expect(eCorrectiveInvoice.correctedMetadata.invoiceDate).toBe('2026-09-15');
  });

  it("should carry the buyer's tax number from the issued snapshot, never re-read from the order", () => {
    const originalDocument = makeOriginalDocument({
      buyer: makeBuyer({ scheme: 'pl-nip', value: '6460558758' }),
    });
    const { eCorrectiveInvoice } = compose(makeCommand({ originalDocument }));
    expect(eCorrectiveInvoice.metadata.consumerTIN).toBe('6460558758');
  });

  it('should omit consumerTIN for a buyer the original document carried none for', () => {
    const { eCorrectiveInvoice } = compose();
    expect('consumerTIN' in eCorrectiveInvoice.metadata).toBe(false);
  });

  it('should carry the free-text reason onto correctionReason', () => {
    const { eCorrectiveInvoice } = compose(makeCommand({ reason: 'price adjustment' }));
    expect(eCorrectiveInvoice.correctionReason).toBe('price adjustment');
  });

  it('should omit correctionReason when the caller supplied none', () => {
    const { eCorrectiveInvoice } = compose(makeCommand({ reason: undefined }));
    expect('correctionReason' in eCorrectiveInvoice).toBe(false);
  });

  it('should report the CORRECTED per-line figures as documentLines, keyed 1-based', () => {
    const { documentLines } = composeDocument();
    expect(documentLines).toEqual([
      { lineNumber: 1, unitNet: 40, net: 40, tax: 9.2, gross: 49.2 },
    ]);
  });

  it('should populate BOTH correctedLines (before) and correctingLines (after)', () => {
    const { eCorrectiveInvoice } = compose();
    expect(eCorrectiveInvoice.correctedLines).toEqual([
      expect.objectContaining({ quantity: '2', netTotalLineValue: 8000, taxValue: 1840 }),
    ]);
    expect(eCorrectiveInvoice.correctingLines).toEqual([
      expect.objectContaining({ quantity: '1', netTotalLineValue: 4000, taxValue: 920 }),
    ]);
  });

  it('should carry a line no correction entry names through UNCHANGED into the after state', () => {
    const originalDocument = makeOriginalDocument({
      lines: [
        { name: 'T-shirt', quantity: 2, unitPriceGross: 49.2, taxRate: '23' },
        { name: 'Socks', quantity: 3, unitPriceGross: 10, taxRate: '8' },
      ],
    });
    const { eCorrectiveInvoice } = compose(
      makeCommand({ originalDocument, lines: [{ originalLineNumber: 1, newQuantity: 1 }] }),
    );

    expect(eCorrectiveInvoice.correctingLines).toEqual([
      expect.objectContaining({ productOrServiceName: 'T-shirt', quantity: '1' }),
      expect.objectContaining({ productOrServiceName: 'Socks', quantity: '3' }),
    ]);
    // The untouched line's own rate group is still summarised on the correction.
    expect(eCorrectiveInvoice.metadata.netValueByTaxRate).toEqual(
      expect.objectContaining({ '8': 2778 }),
    );
  });

  it('should apply a new unit price as well as a new quantity', () => {
    const { eCorrectiveInvoice } = compose(
      makeCommand({ lines: [{ originalLineNumber: 1, newUnitPriceGross: 24.6 }] }),
    );
    // Quantity is untouched at 2, so the corrected gross is 2 x 24.60 = 4920.
    expect(eCorrectiveInvoice.correctingMetadata.grossSaleValue).toBe(4920);
  });

  it('should put the hub marker on the eCorrectiveInvoice object when the connection relays', () => {
    const request = compose(makeCommand(), makeConfig({ eInvoicingHubEnabled: true }));
    expect(request.eCorrectiveInvoice.eInvoicingHub).toBe('KSEF');
  });

  it('should omit the hub marker when the connection does not relay', () => {
    const request = compose();
    expect('eInvoicingHub' in request.eCorrectiveInvoice).toBe(false);
  });

  it('should never mutate the caller-assembled originalDocument snapshot', () => {
    const originalDocument = makeOriginalDocument();
    const before = JSON.stringify(originalDocument.lines);
    compose(makeCommand({ originalDocument }));
    expect(JSON.stringify(originalDocument.lines)).toBe(before);
  });
});

describe('composeCorrectiveInvoiceDocument - refusals happen before the boundary', () => {
  it('should refuse when no original-document snapshot was supplied', () => {
    expect(() => compose(makeCommand({ originalDocument: undefined }))).toThrow(
      EparagonyConfigException,
    );
  });

  it('should refuse a currency other than PLN, same as a plain invoice', () => {
    expect(() =>
      compose(makeCommand({ originalDocument: makeOriginalDocument({ currency: 'EUR' }) })),
    ).toThrow(EparagonyConfigException);
  });

  it('should refuse when the connection declares no seller tax number', () => {
    expect(() => compose(makeCommand(), makeConfig({ merchantTIN: undefined }))).toThrow(
      EparagonyConfigException,
    );
  });

  it('should refuse when the connection declares no seller name, REQUIRED on a correction', () => {
    expect(() => compose(makeCommand(), makeConfig({ merchantName: undefined }))).toThrow(
      EparagonyConfigException,
    );
  });

  it('should refuse when the connection declares no seller address, REQUIRED on a correction', () => {
    expect(() => compose(makeCommand(), makeConfig({ merchantAddress: undefined }))).toThrow(
      EparagonyConfigException,
    );
  });

  it('should refuse an INCOMPLETE seller address rather than render a partial one', () => {
    expect(() =>
      compose(
        makeCommand(),
        makeConfig({
          merchantAddress: { ...SELLER_ADDRESS, number: '   ' },
        }),
      ),
    ).toThrow(EparagonyConfigException);
  });

  it('should refuse when the original document carries no legal number to reference', () => {
    expect(() =>
      compose(makeCommand({ originalDocument: makeOriginalDocument({ documentNumber: '  ' }) })),
    ).toThrow(EparagonyConfigException);
  });

  it('should refuse an original issue date that is not a YYYY-MM-DD calendar date', () => {
    expect(() =>
      compose(
        makeCommand({
          originalDocument: makeOriginalDocument({ issueDate: '2026-09-15T00:00:00.000Z' }),
        }),
      ),
    ).toThrow(EparagonyConfigException);
  });

  it('should refuse an unresolvable tax rate on an original line, reusing the invoice policy', () => {
    const originalDocument = makeOriginalDocument({
      lines: [{ name: 'Mystery', quantity: 1, unitPriceGross: 10, taxRate: '' }],
    });
    expect(() => compose(makeCommand({ originalDocument }))).toThrow(EparagonyConfigException);
  });

  it('should refuse a correction line naming a position the original document does not have', () => {
    expect(() =>
      compose(makeCommand({ lines: [{ originalLineNumber: 5, newQuantity: 1 }] })),
    ).toThrow(EparagonyConfigException);
  });

  it('should refuse a correction line naming position 0, since positions are 1-based', () => {
    expect(() =>
      compose(makeCommand({ lines: [{ originalLineNumber: 0, newQuantity: 1 }] })),
    ).toThrow(EparagonyConfigException);
  });

  it('should refuse the same original line named more than once', () => {
    expect(() =>
      compose(
        makeCommand({
          lines: [
            { originalLineNumber: 1, newQuantity: 1 },
            { originalLineNumber: 1, newUnitPriceGross: 40 },
          ],
        }),
      ),
    ).toThrow(EparagonyConfigException);
  });

  it('should refuse a correction naming no lines', () => {
    expect(() => compose(makeCommand({ lines: [] }))).toThrow(EparagonyConfigException);
  });

  it('should refuse when the original document has no lines', () => {
    expect(() =>
      compose(makeCommand({ originalDocument: makeOriginalDocument({ lines: [] }) })),
    ).toThrow(EparagonyConfigException);
  });
});
