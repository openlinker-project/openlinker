/**
 * eparagony.pl Invoice Mapper - unit tests (#3192)
 *
 * The centre of gravity is the ARITHMETIC. The vendor takes a net-shaped invoice
 * and OpenLinker holds the buyer-paid gross, so net has to be derived; these
 * tests pin the one property that makes the derivation trustworthy - every
 * summary reconciles EXACTLY, to the grosz, with the lines beneath it and with
 * the gross the buyer paid.
 *
 * The first case is the body the live sandbox POC actually accepted, so a change
 * that silently reshapes the wire fails here rather than at the vendor.
 *
 * @module libs/integrations/eparagony/src/infrastructure/adapters/__tests__
 */
import { BuyerProfile, CURRENCY_REJECTION_MARKERS } from '@openlinker/core/invoicing';
import type {
  BuyerAddress,
  InvoiceLine,
  IssueInvoiceCommand,
  TaxIdentifier,
} from '@openlinker/core/invoicing';

import { EparagonyConfigException } from '../../../domain/exceptions/eparagony-config.exception';
import type {
  EparagonyDocumentStatusResponse,
  EparagonyInvoiceTaxRate,
} from '../../../domain/types/eparagony-api.types';
import type { EparagonyConnectionConfig } from '../../../domain/types/eparagony-config.types';
import {
  readClearanceReference,
  readDocumentUrl,
  readInvoiceNumber,
  readKsefInvoice,
  resolveBuyerHandleSchemeTag,
  splitStreetAndNumber,
  composeInvoiceDocument,
  toIssuedDocumentSeller,
  toRegimeCalendarDate,
  toRegulatoryClearanceResult,
} from '../eparagony-invoice.mapper';

const CONNECTION_ID = 'conn-eparagony-1';
const DOCUMENT_TOKEN = '03f75ffc-4808-4135-b8fe-b79451c1245f';
const TRANSACTION_TOKEN = 'b09421b0-5425-4a96-9bff-c0236634bb8b';

function makeConfig(overrides: Partial<EparagonyConnectionConfig> = {}): EparagonyConnectionConfig {
  return {
    environment: 'sandbox',
    posId: 'openlinker',
    merchantTIN: '5252556107',
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

function makeCommand(overrides: Partial<IssueInvoiceCommand> = {}): IssueInvoiceCommand {
  return {
    connectionId: CONNECTION_ID,
    orderId: 'ol_order_1',
    buyer: makeBuyer(),
    currency: 'PLN',
    lines: [{ name: 'T-shirt', quantity: 2, unitPriceGross: 49.2, taxRate: '23' }],
    idempotencyKey: 'invoice:conn-eparagony-1:ol_order_1',
    ...overrides,
  };
}

function composeDocument(
  command: IssueInvoiceCommand = makeCommand(),
  config: EparagonyConnectionConfig = makeConfig(),
): ReturnType<typeof composeInvoiceDocument> {
  return composeInvoiceDocument({
    command,
    config,
    documentToken: DOCUMENT_TOKEN,
    transactionToken: TRANSACTION_TOKEN,
  });
}

/** The wire body alone, for the many assertions that do not care about the report. */
function compose(
  command: IssueInvoiceCommand = makeCommand(),
  config: EparagonyConnectionConfig = makeConfig(),
): ReturnType<typeof composeInvoiceDocument>['request'] {
  return composeDocument(command, config).request;
}

/** Run a composition that must refuse, and hand back the refusal itself. */
function captureRefusal(run: () => unknown): EparagonyConfigException {
  try {
    run();
  } catch (error) {
    if (error instanceof EparagonyConfigException) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a refusal, but the composition succeeded');
}

/** Sum the per-rate map, whatever subset of codes it carries. */
function sumRateMap(map: Partial<Record<EparagonyInvoiceTaxRate, number>>): number {
  return Object.values(map).reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

describe('composeInvoiceDocument - the shape the live sandbox accepted', () => {
  it('emits the COMPLETE metadata the POC body carried, plus currency and orderId and nothing else', () => {
    const request = compose();

    expect(request.posId).toBe('openlinker');
    expect(request.documentToken).toBe(DOCUMENT_TOKEN);
    // Required whenever `documentToken` is sent; omitting it is a 400.
    expect(request.transactionToken).toBe(TRANSACTION_TOKEN);
    expect(request.eInvoice.invoiceType).toBe('VAT');
    // `toEqual`, NOT `toMatchObject`: a parity assertion that passes over extra
    // keys cannot support a parity claim, and the next field added to `metadata`
    // would enter the wire silently. The two keys beyond the POC body -
    // `currency` and `orderId` - are named here rather than tolerated, which is
    // what makes this test the wire's real shape.
    expect(request.eInvoice.metadata).toEqual({
      vatCalculationMethod: 'SUM_OF_RATES_NET',
      calculationValidation: 'NONE',
      grossSaleValue: 9840,
      merchantTIN: '5252556107',
      consumerName: 'Firma Polska sc.',
      consumerAddress: {
        street: 'Pl. Obroncow Lublina',
        number: '73',
        postalCode: '20-601',
        city: 'Warszawa',
        country: 'PL',
      },
      netValueByTaxRate: { '23': 8000 },
      taxValueByTaxRate: { '23': 1840 },
      currency: 'PLN',
      orderId: 'ol_order_1',
    });
    expect(request.eInvoice.lines).toEqual([
      {
        productOrServiceName: 'T-shirt',
        quantity: '2',
        netUnitPrice: 4000,
        netTotalLineValue: 8000,
        taxRate: '23',
        taxValue: 1840,
      },
    ]);
  });

  it('puts the hub marker on the eInvoice object itself, never inside extensions', () => {
    const request = compose(makeCommand(), makeConfig({ eInvoicingHubEnabled: true }));
    expect(request.eInvoice.eInvoicingHub).toBe('KSEF');
    expect('extensions' in request.eInvoice).toBe(false);
  });

  it('omits the hub marker entirely when the connection does not relay', () => {
    const request = compose();
    expect('eInvoicingHub' in request.eInvoice).toBe(false);
  });
});

describe('composeInvoiceDocument - the arithmetic reconciles exactly', () => {
  it('derives net once per RATE GROUP so net plus tax is the gross the buyer paid', () => {
    const lines: InvoiceLine[] = [
      { name: 'Alpha', quantity: 1, unitPriceGross: 12.3, taxRate: '23' },
      { name: 'Beta', quantity: 1, unitPriceGross: 10.5, taxRate: '5' },
      { name: 'Gamma', quantity: 1, unitPriceGross: 24.6, taxRate: '23' },
    ];
    const request = compose(makeCommand({ lines }));
    const { metadata } = request.eInvoice;

    expect(metadata.grossSaleValue).toBe(4740);
    expect(metadata.netValueByTaxRate).toEqual({ '23': 3000, '5': 1000 });
    expect(metadata.taxValueByTaxRate).toEqual({ '23': 690, '5': 50 });
    // The invariant, stated as arithmetic rather than as a comment.
    expect(sumRateMap(metadata.netValueByTaxRate) + sumRateMap(metadata.taxValueByTaxRate)).toBe(
      metadata.grossSaleValue,
    );
  });

  it('emits lines in the ORDER THE COMMAND GAVE, not grouped by rate', () => {
    // Load-bearing, not cosmetic. Core persists `issuedLineSnapshot.lines` as
    // `cmd.lines` verbatim and `CorrectionLine.originalLineNumber` names a line
    // BY ITS POSITION, so a document whose lines were reordered would have
    // #3193 credit the wrong line on a transmitted fiscal document.
    // `InvoiceService.buildContent` pairs `documentLines` by `index + 1` over
    // the same array. The ARITHMETIC still groups by rate; only the emitted
    // array does not.
    //
    // Determinism is unaffected: command order is as deterministic as rate order.
    const lines: InvoiceLine[] = [
      { name: 'Alpha', quantity: 1, unitPriceGross: 12.3, taxRate: '23' },
      { name: 'Beta', quantity: 1, unitPriceGross: 10.5, taxRate: '5' },
      { name: 'Gamma', quantity: 1, unitPriceGross: 24.6, taxRate: '23' },
    ];
    const request = compose(makeCommand({ lines }));

    expect(request.eInvoice.lines.map((line) => line.productOrServiceName)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
    expect(JSON.stringify(compose(makeCommand({ lines })))).toBe(JSON.stringify(request));
  });

  it('reports documentLines that match the wire body line for line', () => {
    // Without these, `InvoiceService.buildContent` recomputes each line as
    // `round(gross / (1 + r))` INDEPENDENTLY - the exact arithmetic this mapper
    // exists to avoid - so OpenLinker's contents card would state
    // [0.01, 0.01, 0.01] net against a document that says [0.01, 0.01, 0.00].
    const lines: InvoiceLine[] = [
      { name: 'One', quantity: 1, unitPriceGross: 0.01, taxRate: '23' },
      { name: 'Two', quantity: 1, unitPriceGross: 0.01, taxRate: '23' },
      { name: 'Three', quantity: 1, unitPriceGross: 0.01, taxRate: '23' },
    ];
    const { request, documentLines } = composeDocument(makeCommand({ lines }));

    // 1-based and in command order, which is what `buildContent` keys on.
    expect(documentLines.map((line) => line.lineNumber)).toEqual([1, 2, 3]);
    // Major units on the neutral report, minor units on the wire.
    expect(documentLines.map((line) => line.net)).toEqual([0.01, 0.01, 0]);
    expect(documentLines.map((line) => line.tax)).toEqual([0, 0, 0.01]);
    expect(documentLines.map((line) => line.gross)).toEqual([0.01, 0.01, 0.01]);
    request.eInvoice.lines.forEach((wireLine, index) => {
      expect(documentLines[index].net * 100).toBeCloseTo(wireLine.netTotalLineValue, 6);
      expect(documentLines[index].tax * 100).toBeCloseTo(wireLine.taxValue, 6);
    });
  });

  it.each<{ label: string; gross: number[] }>([
    // The residual runs BELOW zero. Ten lines of one grosz at 23%: the group's
    // net is 8 while the first nine lines round up to 1 each, so a bare
    // `netGroup - allocated` would hand the tenth line -1.
    { label: 'residual below zero', gross: Array.from({ length: 10 }, () => 0.01) },
    // The residual runs ABOVE the last line's own gross, which is the harder
    // direction and the one a `>= 0` clamp alone misses: gross 3+3+1 at 23%
    // gives a group net of 6, the first two lines round to 2 each, and the third
    // computes 6-4=2 against a gross of 1 - so `taxValue` is 1-2 = -1, a
    // NEGATIVE VAT on a document bound for a tax authority, with every summary
    // still reconciling. Not constructed: `toShippingLines` appends a small
    // per-rate share LAST and `groupByRate` preserves first-seen order, so a
    // shipping share is the last member of its group whenever its rate already
    // appeared above it.
    { label: 'residual above the last gross', gross: [0.03, 0.03, 0.01] },
    {
      label: 'residual above, longer group',
      gross: [...Array.from({ length: 9 }, () => 0.03), 0.01],
    },
    {
      label: 'residual above, realistic basket',
      gross: [...Array.from({ length: 9 }, () => 1), 0.01],
    },
  ])(
    'keeps every line inside 0 <= net <= gross, so no line carries a negative net or a negative tax ($label)',
    ({ gross }) => {
      const lines: InvoiceLine[] = gross.map((unitPriceGross, index) => ({
        name: `L${index + 1}`,
        quantity: 1,
        unitPriceGross,
        taxRate: '23' as const,
      }));
      const { metadata, lines: wire } = compose(makeCommand({ lines })).eInvoice;

      // The real invariant, both bounds, per line. Only the lower half was held
      // before, and only on the last member.
      wire.forEach((line, index) => {
        const lineGross = Math.round(gross[index] * 100);
        expect(line.netTotalLineValue).toBeGreaterThanOrEqual(0);
        expect(line.netTotalLineValue).toBeLessThanOrEqual(lineGross);
        expect(line.taxValue).toBeGreaterThanOrEqual(0);
        expect(line.netTotalLineValue + line.taxValue).toBe(lineGross);
      });

      // The repair moves net BETWEEN lines and never changes the group's total,
      // which is what the summary reconciles against.
      expect(wire.reduce((sum, line) => sum + line.netTotalLineValue, 0)).toBe(
        metadata.netValueByTaxRate['23'],
      );
      expect(wire.reduce((sum, line) => sum + line.taxValue, 0)).toBe(
        metadata.taxValueByTaxRate['23'],
      );
      expect(sumRateMap(metadata.netValueByTaxRate) + sumRateMap(metadata.taxValueByTaxRate)).toBe(
        metadata.grossSaleValue,
      );
    },
  );

  it('reports the same repaired figures to core that it put on the wire', () => {
    // The surplus repair moves net between lines, so `documentLines` has to be
    // built from the REPAIRED allocation - otherwise OpenLinker's contents card
    // would state the pre-repair figures against a document carrying the others.
    const lines: InvoiceLine[] = [0.03, 0.03, 0.01].map((unitPriceGross, index) => ({
      name: `L${index + 1}`,
      quantity: 1,
      unitPriceGross,
      taxRate: '23' as const,
    }));
    const { request, documentLines } = composeDocument(makeCommand({ lines }));

    expect(documentLines.map((line) => line.tax)).toEqual([0.01, 0, 0]);
    request.eInvoice.lines.forEach((wireLine, index) => {
      expect(Math.round(documentLines[index].net * 100)).toBe(wireLine.netTotalLineValue);
      expect(Math.round(documentLines[index].tax * 100)).toBe(wireLine.taxValue);
    });
  });

  it('makes the LAST line of a group absorb the rounding residual', () => {
    // Three lines of one grosz at 23%: rounded independently each line's net is
    // 1, summing to 3, while the group's own net is 2. Without the absorption
    // the document's lines would contradict its own summary by a grosz.
    const lines: InvoiceLine[] = [
      { name: 'One', quantity: 1, unitPriceGross: 0.01, taxRate: '23' },
      { name: 'Two', quantity: 1, unitPriceGross: 0.01, taxRate: '23' },
      { name: 'Three', quantity: 1, unitPriceGross: 0.01, taxRate: '23' },
    ];
    const request = compose(makeCommand({ lines }));
    const { metadata } = request.eInvoice;

    expect(request.eInvoice.lines.map((line) => line.netTotalLineValue)).toEqual([1, 1, 0]);
    expect(request.eInvoice.lines.map((line) => line.taxValue)).toEqual([0, 0, 1]);
    expect(metadata.netValueByTaxRate).toEqual({ '23': 2 });
    expect(metadata.taxValueByTaxRate).toEqual({ '23': 1 });
    expect(metadata.grossSaleValue).toBe(3);
  });

  it('keeps the lines of every group summing back to that group exactly', () => {
    const lines: InvoiceLine[] = [
      { name: 'A', quantity: 3, unitPriceGross: 49.99, taxRate: '23' },
      { name: 'B', quantity: 7, unitPriceGross: 1.11, taxRate: '23' },
      { name: 'C', quantity: 2, unitPriceGross: 3.33, taxRate: '8' },
      { name: 'D', quantity: 1, unitPriceGross: 19.99, taxRate: '8' },
    ];
    const { metadata, lines: wire } = compose(makeCommand({ lines })).eInvoice;

    for (const code of ['23', '8'] as const) {
      const members = wire.filter((line) => line.taxRate === code);
      const net = members.reduce((sum, line) => sum + line.netTotalLineValue, 0);
      const tax = members.reduce((sum, line) => sum + line.taxValue, 0);
      expect(net).toBe(metadata.netValueByTaxRate[code]);
      expect(tax).toBe(metadata.taxValueByTaxRate[code]);
    }
    expect(sumRateMap(metadata.netValueByTaxRate) + sumRateMap(metadata.taxValueByTaxRate)).toBe(
      metadata.grossSaleValue,
    );
  });

  it('sends an EMPTY tax map when every line is exempt, which the vendor has never been asked', () => {
    // Pinning current behaviour rather than asserting it is right. The wire
    // contract lists `taxValueByTaxRate` as required; present-but-empty probably
    // satisfies that, but the POC exercised taxed lines only, so this is
    // unverified against the vendor and is recorded as such on the PR.
    const lines: InvoiceLine[] = [
      { name: 'Exempt', quantity: 1, unitPriceGross: 20, taxRate: 'zw' },
      { name: 'Reverse charge', quantity: 1, unitPriceGross: 30, taxRate: 'oo' },
    ];
    const { metadata } = compose(makeCommand({ lines })).eInvoice;

    expect(metadata.taxValueByTaxRate).toEqual({});
    expect(metadata.netValueByTaxRate).toEqual({ EP: 2000, RCP: 3000 });
    expect(metadata.grossSaleValue).toBe(5000);
  });

  it('carries a zero-rated group in the net map ONLY, never in the tax map', () => {
    // The vendor's two summary maps declare different key sets; a `ZRD: 0` key
    // would be a property the schema does not declare.
    const lines: InvoiceLine[] = [
      { name: 'Taxed', quantity: 1, unitPriceGross: 12.3, taxRate: '23' },
      { name: 'Exempt', quantity: 1, unitPriceGross: 20, taxRate: 'zw' },
    ];
    const { metadata, lines: wire } = compose(makeCommand({ lines })).eInvoice;

    expect(metadata.netValueByTaxRate).toEqual({ '23': 1000, EP: 2000 });
    expect(metadata.taxValueByTaxRate).toEqual({ '23': 230 });
    expect('EP' in metadata.taxValueByTaxRate).toBe(false);
    // `taxValue` is required on EVERY line, including an exempt one.
    expect(wire[1]).toMatchObject({ taxRate: 'EP', netTotalLineValue: 2000, taxValue: 0 });
  });
});

describe('composeInvoiceDocument - the buyer', () => {
  it('sends the buyer tax number verbatim, with no validation or reformatting', () => {
    // ADR-073 decision 5: core never pre-judges which identifiers a provider
    // accepts. This one IS checksum-verified on the vendor's side, so the
    // refusal is reachable - and it must arrive from the vendor, not from here.
    const request = compose(
      makeCommand({ buyer: makeBuyer({ scheme: 'pl-nip', value: '6460558758' }) }),
    );
    expect(request.eInvoice.metadata.consumerTIN).toBe('6460558758');

    const malformed = compose(makeCommand({ buyer: makeBuyer({ value: '6460558ZZZ' }) }));
    expect(malformed.eInvoice.metadata.consumerTIN).toBe('6460558ZZZ');
  });

  it('takes an UNTAGGED tax id rather than dropping it', () => {
    // An absent `scheme` means "untagged, decide for your own market", never
    // "not a tax id" - dropping it would silently omit the buyer's tax number
    // from a document that legally needs it.
    const request = compose(makeCommand({ buyer: makeBuyer({ value: '6460558758' }) }));
    expect(request.eInvoice.metadata.consumerTIN).toBe('6460558758');
  });

  it('omits the key entirely for a B2C buyer, which is what makes it a B2C invoice', () => {
    const request = compose();
    expect('consumerTIN' in request.eInvoice.metadata).toBe(false);
  });

  it('omits the key for a whitespace-only value rather than sending blanks', () => {
    const request = compose(makeCommand({ buyer: makeBuyer({ value: '   ' }) }));
    expect('consumerTIN' in request.eInvoice.metadata).toBe(false);
  });

  it('splits the street from the building number and carries line2 as the apartment', () => {
    const request = compose(
      makeCommand({
        buyer: makeBuyer(null, makeAddress({ line1: 'ul. Grzybowska 2', line2: 'lok. 45' })),
      }),
    );
    expect(request.eInvoice.metadata.consumerAddress).toEqual({
      street: 'ul. Grzybowska',
      number: '2',
      apartment: 'lok. 45',
      postalCode: '20-601',
      city: 'Warszawa',
      country: 'PL',
    });
  });

  it('omits the apartment key when the buyer has no second address line', () => {
    const request = compose();
    expect('apartment' in request.eInvoice.metadata.consumerAddress).toBe(false);
  });

  it('passes a foreign postcode through for the vendor to judge', () => {
    // The vendor's own pattern is domestic-only. Refusing here would decide
    // something the vendor is the judge of, and its rejection is informative.
    const request = compose(
      makeCommand({
        buyer: makeBuyer(null, makeAddress({ postalCode: 'SW1A 1AA', countryIso2: 'GB' })),
      }),
    );
    expect(request.eInvoice.metadata.consumerAddress.postalCode).toBe('SW1A 1AA');
    expect(request.eInvoice.metadata.consumerAddress.country).toBe('GB');
  });
});

describe('composeInvoiceDocument - the seller', () => {
  it('omits the seller name and address when the connection configures none', () => {
    const request = compose();
    expect('merchantName' in request.eInvoice.metadata).toBe(false);
    expect('merchantAddress' in request.eInvoice.metadata).toBe(false);
  });

  it("copies the operator's configured seller party across unchanged", () => {
    const request = compose(
      makeCommand(),
      makeConfig({
        merchantName: 'OpenLinker POC Sp. z o.o.',
        merchantAddress: {
          street: 'ul. Grzybowska',
          number: '2',
          postalCode: '00-131',
          city: 'Warszawa',
          country: 'PL',
        },
      }),
    );
    expect(request.eInvoice.metadata.merchantName).toBe('OpenLinker POC Sp. z o.o.');
    expect(request.eInvoice.metadata.merchantAddress).toEqual({
      street: 'ul. Grzybowska',
      number: '2',
      postalCode: '00-131',
      city: 'Warszawa',
      country: 'PL',
    });
  });
});

describe('composeInvoiceDocument - optional metadata', () => {
  it('carries the order id so a support conversation can find the document', () => {
    expect(compose().eInvoice.metadata.orderId).toBe('ol_order_1');
  });

  it('stamps the settlement currency explicitly rather than leaving it to the account default', () => {
    expect(compose().eInvoice.metadata.currency).toBe('PLN');
  });

  it('omits the invoice number when OpenLinker did not allocate one', () => {
    // This adapter is not a document-number consumer today, so the vendor
    // generates the legal number itself.
    expect('invoiceNumber' in compose().eInvoice.metadata).toBe(false);
  });

  it('honours an OpenLinker-allocated number when one is supplied', () => {
    const request = compose(makeCommand({ documentNumber: 'OL/2026/09/1' }));
    expect(request.eInvoice.metadata.invoiceNumber).toBe('OL/2026/09/1');
  });

  it("renders the issuance instant as the calendar date in the REGIME's own zone", () => {
    // 23:30 UTC on 15 January is already the 16th in Warsaw. A UTC-derived date
    // would misdate the document by a day.
    const request = compose(makeCommand({ issuedAt: new Date('2026-01-15T23:30:00Z') }));
    expect(request.eInvoice.metadata.invoiceDate).toBe('2026-01-16');
  });

  it('omits the issue date entirely when the command carries no instant', () => {
    expect('invoiceDate' in compose().eInvoice.metadata).toBe(false);
  });

  it('passes a calendar sale date through and ignores a malformed one', () => {
    expect(compose(makeCommand({ saleDate: '2026-09-15' })).eInvoice.metadata.saleEndDate).toBe(
      '2026-09-15',
    );
    expect(
      'saleEndDate' in compose(makeCommand({ saleDate: '15/09/2026' })).eInvoice.metadata,
    ).toBe(false);
  });
});

describe('composeInvoiceDocument - refusals before anything is sent', () => {
  it('refuses a currency it would need an exchange rate for', () => {
    // ADR-040: OpenLinker's own FX stamp is analytics-only and must never
    // supply a fiscal document's rate, and there is no other source.
    expect(() => compose(makeCommand({ currency: 'EUR' }))).toThrow(EparagonyConfigException);
  });

  it('words the currency refusal so core resolves it to the currency failure code', () => {
    // `CURRENCY_REJECTION_MARKERS` is matched case-insensitively against the
    // adapter's own OL-authored reason - a reword here silently degrades the
    // operator's failure code to the generic one.
    try {
      compose(makeCommand({ currency: 'EUR' }));
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(EparagonyConfigException);
      // Asserted against CORE's published constant, not against a phrase copied
      // here - `invoicing.types.ts` publishes it specifically so a core reword
      // breaks this build rather than silently degrading the operator's failure
      // code to the generic one. Pinning our own wording would prove nothing
      // about core.
      const haystack = (error as EparagonyConfigException).reason.toLowerCase();
      expect(CURRENCY_REJECTION_MARKERS.some((marker) => haystack.includes(marker))).toBe(true);
      expect((error as EparagonyConfigException).failureMode).toBe('rejected');
    }
  });

  it('accepts a currency whatever case or padding it arrives in', () => {
    expect(() => compose(makeCommand({ currency: ' pln ' }))).not.toThrow();
  });

  it('refuses when the connection declares no seller tax number', () => {
    // Mandatory on every invoice, and validated against the vendor account, so
    // a wrong or missing value fails every invoice rather than one order.
    expect(() => compose(makeCommand(), makeConfig({ merchantTIN: undefined }))).toThrow(
      EparagonyConfigException,
    );
    expect(() => compose(makeCommand(), makeConfig({ merchantTIN: '  ' }))).toThrow(
      EparagonyConfigException,
    );
  });

  it('words the seller-tax-number refusal so core does NOT read it as a buyer problem', () => {
    // Core's `TAX_ID_REJECTION_MARKERS` are ['tax id','tax-id','taxid',
    // 'tax identifier']. A reword to "seller tax ID" would classify a missing
    // CONNECTION field as `buyer-tax-id-invalid` and send the operator to
    // correct the BUYER's data instead. "tax number" is deliberate.
    //
    // Asserted on BOTH texts. `classifyFailureCode` prefers `reason` but falls
    // back to `error.message` whenever `reason` is not a string, so under
    // refactoring the two are one haystack.
    const error = captureRefusal(() =>
      compose(makeCommand(), makeConfig({ merchantTIN: undefined })),
    );

    expect(error.reason).toContain('seller tax number');
    for (const marker of ['tax id', 'tax-id', 'taxid', 'tax identifier']) {
      expect(error.reason.toLowerCase()).not.toContain(marker);
      expect(error.message.toLowerCase()).not.toContain(marker);
    }
  });

  it('repeats the remedy in the MESSAGE, which is the only text this lane persists', () => {
    // `InvoiceService.sanitizeError` builds `invoice_records.errorMessage` from
    // `error.message`; `reason` is matched against three marker lists and then
    // DISCARDED. So a remedy that lives only in `reason` reaches nothing - not
    // `failureReason`, not `errorMessage`, not the log - and the operator reads
    // "The invoicing provider rejected the request." about a request no provider
    // saw. Both refusals that have an operator remedy repeat it in `message`.
    expect(
      captureRefusal(() => compose(makeCommand(), makeConfig({ merchantTIN: undefined }))).message,
    ).toContain('Set it on the connection and re-issue');

    expect(
      captureRefusal(() =>
        compose(
          makeCommand({ lines: [{ name: 'X', quantity: 1, unitPriceGross: 10, taxRate: '' }] }),
        ),
      ).message,
    ).toContain('Set the rate on the product and re-issue');
  });

  it('refuses a line whose rate is not an invoice rate in this regime', () => {
    expect(() =>
      compose(
        makeCommand({ lines: [{ name: 'X', quantity: 1, unitPriceGross: 10, taxRate: '7' }] }),
      ),
    ).toThrow(EparagonyConfigException);
  });

  it('refuses a line with no rate rather than substituting one', () => {
    try {
      compose(
        makeCommand({ lines: [{ name: 'X', quantity: 1, unitPriceGross: 10, taxRate: '' }] }),
      );
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(EparagonyConfigException);
      expect((error as EparagonyConfigException).reason).toContain('no tax rate');
    }
  });

  it('refuses a non-invoiceable quantity', () => {
    expect(() =>
      compose(
        makeCommand({ lines: [{ name: 'X', quantity: 0, unitPriceGross: 10, taxRate: '23' }] }),
      ),
    ).toThrow(EparagonyConfigException);
  });

  it('refuses a negative line, because a credit is a correction document and not a line', () => {
    expect(() =>
      compose(
        makeCommand({ lines: [{ name: 'X', quantity: 1, unitPriceGross: -10, taxRate: '23' }] }),
      ),
    ).toThrow(EparagonyConfigException);
  });

  it('refuses an order with no lines', () => {
    expect(() => compose(makeCommand({ lines: [] }))).toThrow(EparagonyConfigException);
  });

  it.each(['line1', 'postalCode', 'city', 'countryIso2'] as const)(
    'refuses a buyer address whose %s is blank rather than sending the blank',
    (field) => {
      // These four are REQUIRED on the vendor's entity address and `BuyerAddress`
      // guarantees none of them is non-empty, so a blank one used to be sent and
      // rejected with an opaque code - `splitStreetAndNumber('')` even yielded
      // `street: ''` against a required field. This is a PRESENCE check; the
      // FORMAT of a present value still travels verbatim (see the foreign
      // postcode case above).
      for (const blank of ['', '   ']) {
        expect(() =>
          compose(makeCommand({ buyer: makeBuyer(null, makeAddress({ [field]: blank })) })),
        ).toThrow(EparagonyConfigException);
      }
    },
  );

  it('refuses a line whose total cannot be expressed in minor units at all', () => {
    // The `grossMinor === null` arm, distinct from the `< 0` one beside it: a
    // non-finite total has no minor-unit representation, so there is nothing to
    // put on the wire and nothing to round.
    expect(() =>
      compose(
        makeCommand({
          lines: [{ name: 'X', quantity: 1, unitPriceGross: Number.NaN, taxRate: '23' }],
        }),
      ),
    ).toThrow(EparagonyConfigException);
    expect(() =>
      compose(
        makeCommand({
          lines: [
            { name: 'X', quantity: 1, unitPriceGross: Number.POSITIVE_INFINITY, taxRate: '23' },
          ],
        }),
      ),
    ).toThrow(EparagonyConfigException);
  });
});

describe('composeInvoiceDocument - a fractional quantity', () => {
  it('lets the unit price differ from the line total by a grosz while the SUMMARY stays exact', () => {
    // The one case `resolveNetUnitPrice`'s own docblock admits can differ, and
    // it was untested. `calculationValidation: NONE` is what makes the vendor
    // tolerate it; the figures that must reconcile exactly - the per-rate
    // summary and the line's own net plus tax - still do.
    const lines: InvoiceLine[] = [
      { name: 'Cable, per metre', quantity: 1.5, unitPriceGross: 10, taxRate: '23' },
    ];
    const { metadata, lines: wire } = compose(makeCommand({ lines })).eInvoice;

    expect(metadata.grossSaleValue).toBe(1500);
    expect(wire[0].netTotalLineValue + wire[0].taxValue).toBe(1500);
    expect(wire[0].netTotalLineValue).toBe(metadata.netValueByTaxRate['23']);
    expect(wire[0].taxValue).toBe(metadata.taxValueByTaxRate['23']);
    // The tolerated drift: 1220 / 1.5 rounds to 813, and 813 x 1.5 is 1219.5.
    expect(wire[0].quantity).toBe('1.5');
    expect(Math.abs(wire[0].netUnitPrice * 1.5 - wire[0].netTotalLineValue)).toBeLessThanOrEqual(1);
  });
});

describe('toRegulatoryClearanceResult', () => {
  const OFFLINE: EparagonyDocumentStatusResponse = {
    status: 'OFFLINE',
    documentType: 'INVOICE',
    processingMode: 'KSEF',
    invoiceNumber: 'OL-POC/2026/B2B/1',
    documentUrl: 'https://hub.sandbox.eparagony.pl/view/abc',
    ksefInvoice: {
      issueDate: '2026-09-15',
      invoiceHash: 'Gg3ukLWP07vsjm8Jv7vZBhdrCqACxATu8vCBXO/aKDk=',
      invoiceUrl: 'https://qr-demo.ksef.mf.gov.pl/client-app/invoice/5252556107/15-09-2026/x',
      issuerVerificationUrl: 'https://qr-test.ksef.mf.gov.pl/certificate/Nip/5252556107/y',
    },
  };

  const NO_HUB: EparagonyDocumentStatusResponse = {
    status: 'CONFIRMED',
    documentType: 'INVOICE',
    processingMode: 'NONE',
    invoiceNumber: 'OL-POC/2026/NOHUB/1',
    documentUrl: 'https://hub.sandbox.eparagony.pl/view/def',
  };

  const CLEARED: EparagonyDocumentStatusResponse = {
    status: 'CONFIRMED',
    documentType: 'INVOICE',
    processingMode: 'KSEF',
    invoiceNumber: 'OL-POC/2026/B2B/1',
    ksefInvoice: {
      ksefNumber: '5265877635-20250626-010080DD2B5E-26',
      invoiceHash: 'UtQp9Gpc51y-u3xApZjIjgkpZ01js-J8KflSPW8WzIE',
      issueDate: '2026-09-15',
    },
  };

  it('reports an OFFLINE hub document as awaiting submission, with no reference yet', () => {
    // Observed live: the document IS issued and carries its hash and QR codes,
    // and the authority has not minted a number for it.
    expect(toRegulatoryClearanceResult(OFFLINE)).toEqual({
      regulatoryStatus: 'pending-submission',
      clearanceReference: null,
    });
  });

  it('reports a document issued outside the hub as not applicable', () => {
    // Observed live, with no `ksefInvoice` object at all. This is a complete
    // and successful outcome, not a pending one.
    expect(toRegulatoryClearanceResult(NO_HUB)).toEqual({
      regulatoryStatus: 'not-applicable',
      clearanceReference: null,
    });
  });

  it("reports a CONFIRMED hub document as ACCEPTED, carrying the authority's own number", () => {
    // NOT observable in the sandbox - coded from the vendor's contract, where
    // `ksefNumber` is required at CONFIRMED and absent at OFFLINE.
    //
    // `accepted`, never the reserved `cleared`: that value is absent from core's
    // `TerminalRegulatoryStatusValues`, so it would leave a finished document
    // polled for ever. The `CLEARED` fixture name below is the VENDOR's concept
    // (the authority cleared the document), not the neutral status.
    expect(toRegulatoryClearanceResult(CLEARED)).toEqual({
      regulatoryStatus: 'accepted',
      clearanceReference: '5265877635-20250626-010080DD2B5E-26',
    });
  });

  it('terminalises a CONFIRMED document whose processing mode is unreadable', () => {
    // Arm 1 has already returned for an explicit NONE, so anything still here is
    // a relayed document. Requiring `processingMode === KSEF` as well would send
    // a CONFIRMED document with a missing or unrecognised mode to
    // `pending-submission`, which is NON-terminal and STABLE - the #1121 sweep
    // would poll it for ever and it could never self-heal, because unlike an
    // unrecognised STATUS the mode does not change on the next read.
    expect(toRegulatoryClearanceResult({ ...CLEARED, processingMode: undefined })).toMatchObject({
      regulatoryStatus: 'accepted',
    });
    expect(
      toRegulatoryClearanceResult({ ...CLEARED, processingMode: 'SOMETHING_NEW' }),
    ).toMatchObject({ regulatoryStatus: 'accepted' });
  });

  it('reports a transient PENDING as awaiting submission rather than as submitted', () => {
    // PENDING precedes OFFLINE, so calling it `submitted` would claim the
    // authority already holds a document that is not issued yet - and would
    // then have to walk backwards on the next poll.
    expect(toRegulatoryClearanceResult({ ...OFFLINE, status: 'PENDING' })).toMatchObject({
      regulatoryStatus: 'pending-submission',
    });
  });

  it('reports an ERROR as rejected', () => {
    expect(toRegulatoryClearanceResult({ ...OFFLINE, status: 'ERROR' })).toEqual({
      regulatoryStatus: 'rejected',
      clearanceReference: null,
    });
  });

  it('answers not-applicable for a hub-less document whatever its status', () => {
    // The mode is a statement about the DOCUMENT, not about its progress, which
    // is why it is tested before the status.
    expect(toRegulatoryClearanceResult({ ...NO_HUB, status: 'PENDING' })).toMatchObject({
      regulatoryStatus: 'not-applicable',
    });
  });

  it('keeps an unrecognised status non-terminal so the reconciliation self-heals', () => {
    expect(toRegulatoryClearanceResult({ ...OFFLINE, status: 'SOMETHING_NEW' })).toMatchObject({
      regulatoryStatus: 'pending-submission',
    });
  });

  it('degrades to awaiting submission when the response carries no mode at all', () => {
    // A contract break rather than a state - the safe answer is the one that
    // keeps polling and claims nothing.
    expect(toRegulatoryClearanceResult({ status: 'OFFLINE' })).toMatchObject({
      regulatoryStatus: 'pending-submission',
    });
  });
});

describe('status readers', () => {
  it('reads the legal document number the vendor generated', () => {
    expect(readInvoiceNumber({ invoiceNumber: 'OL-POC/2026/B2B/1' })).toBe('OL-POC/2026/B2B/1');
    expect(readInvoiceNumber({})).toBeNull();
    expect(readInvoiceNumber({ invoiceNumber: '   ' })).toBeNull();
  });

  it('reads the document link WITHOUT gating on CONFIRMED', () => {
    // Unlike a receipt, an invoice at OFFLINE is already issued with legal
    // effect and its visualisation carries the authority's offline codes.
    expect(readDocumentUrl({ status: 'OFFLINE', documentUrl: 'https://hub/view/x' })).toBe(
      'https://hub/view/x',
    );
  });

  it('refuses to read a hub block that is not an object', () => {
    expect(readKsefInvoice({ ksefInvoice: 'nope' })).toBeNull();
    expect(readKsefInvoice({ ksefInvoice: ['nope'] })).toBeNull();
    expect(readKsefInvoice({})).toBeNull();
  });

  it('reads no clearance reference at OFFLINE, because the authority has minted none', () => {
    expect(readClearanceReference({ ksefInvoice: { invoiceHash: 'abc' } })).toBeNull();
  });
});

describe('toIssuedDocumentSeller', () => {
  const ADDRESS = {
    street: 'ul. Grzybowska',
    number: '2',
    apartment: '45',
    postalCode: '00-131',
    city: 'Warszawa',
    country: 'PL',
  };

  it('supplies the scheme tag itself, because core holds a bare number and may not mint one', () => {
    const seller = toIssuedDocumentSeller(
      makeConfig({ merchantName: 'OpenLinker POC Sp. z o.o.', merchantAddress: ADDRESS }),
    );
    expect(seller).toEqual({
      name: 'OpenLinker POC Sp. z o.o.',
      taxId: { scheme: 'pl-nip', value: '5252556107' },
      address: {
        line1: 'ul. Grzybowska 2',
        line2: '45',
        city: 'Warszawa',
        postalCode: '00-131',
        countryIso2: 'PL',
      },
    });
  });

  it('reports nothing at all rather than half a seller', () => {
    // The neutral shape requires both a name and an address; a party with a
    // blank address reads as real rather than as unconfigured.
    expect(toIssuedDocumentSeller(makeConfig())).toBeNull();
    expect(toIssuedDocumentSeller(makeConfig({ merchantName: 'Only a name' }))).toBeNull();
    expect(toIssuedDocumentSeller(makeConfig({ merchantAddress: ADDRESS }))).toBeNull();
  });

  it('reports nothing when the name and address are there but the tax number is not', () => {
    // Reachable only through `toIssuedDocumentSeller` on its own - the compose
    // path refuses a TIN-less connection several lines earlier - and the neutral
    // `IssuedDocumentSeller.taxId` is required, so there is no half to report.
    expect(
      toIssuedDocumentSeller(
        makeConfig({ merchantTIN: undefined, merchantName: 'A name', merchantAddress: ADDRESS }),
      ),
    ).toBeNull();
  });

  it.each(['street', 'number', 'postalCode', 'city', 'country'] as const)(
    'reports nothing for an address missing %s, rather than rendering "undefined" into the snapshot',
    (field) => {
      // `config` is JSONB and the raw JSON editor bypasses the connection form,
      // so a partial object is reachable even with the shape validator in front
      // of it - and `${street} ${number}` on a half-filled one renders the
      // literal "undefined undefined" into the issued-document snapshot core
      // keeps, where an operator reads it as the seller's real address.
      const partial = { ...ADDRESS, [field]: undefined } as unknown as typeof ADDRESS;
      expect(
        toIssuedDocumentSeller(
          makeConfig({ merchantName: 'OpenLinker POC Sp. z o.o.', merchantAddress: partial }),
        ),
      ).toBeNull();
    },
  );
});

describe('composeInvoiceDocument - an incomplete seller address', () => {
  it('omits merchantAddress entirely rather than transmitting a half-filled one', () => {
    const partial = {
      street: 'ul. Grzybowska',
      postalCode: '00-131',
      city: 'Warszawa',
      country: 'PL',
    } as unknown as NonNullable<EparagonyConnectionConfig['merchantAddress']>;
    const request = compose(
      makeCommand(),
      makeConfig({ merchantName: 'OpenLinker POC Sp. z o.o.', merchantAddress: partial }),
    );

    expect('merchantAddress' in request.eInvoice.metadata).toBe(false);
    // The name is unaffected - the two keys are independent on the wire.
    expect(request.eInvoice.metadata.merchantName).toBe('OpenLinker POC Sp. z o.o.');
  });
});

describe('splitStreetAndNumber', () => {
  it('splits the trailing building number off the address line', () => {
    expect(splitStreetAndNumber('ul. Grzybowska 2')).toEqual({
      street: 'ul. Grzybowska',
      number: '2',
    });
    expect(splitStreetAndNumber('Marszalkowska 12/34')).toEqual({
      street: 'Marszalkowska',
      number: '12/34',
    });
    expect(splitStreetAndNumber('Dluga 7a')).toEqual({ street: 'Dluga', number: '7a' });
  });

  it('MIS-ASSIGNS the building number on the "m." apartment form, which is the accepted cost', () => {
    // Stated rather than hidden: on this common Polish form the apartment ends
    // up in the vendor's building-number field on a document bound for the
    // national hub. Concatenating still re-reads as the original line, so
    // nothing is lost - but the claim is "cannot lose data", not "cannot
    // mis-assign", and the docblock now says so.
    expect(splitStreetAndNumber('Aleje Jerozolimskie 44 m. 8')).toEqual({
      street: 'Aleje Jerozolimskie 44 m.',
      number: '8',
    });
    // The two forms it does get right, for contrast.
    expect(splitStreetAndNumber('ul. Kwiatowa 12/3')).toEqual({
      street: 'ul. Kwiatowa',
      number: '12/3',
    });
    expect(splitStreetAndNumber('Plac Zbawiciela 1A')).toEqual({
      street: 'Plac Zbawiciela',
      number: '1A',
    });
  });

  it('keeps the whole line as the street when it names no building number', () => {
    // The field is required and non-empty, and refusing a real paid order over
    // a formatting detail would be worse. Nothing is lost: street plus number
    // still re-reads as the original line.
    expect(splitStreetAndNumber('Main Street')).toEqual({ street: 'Main Street', number: '-' });
    expect(splitStreetAndNumber('12')).toEqual({ street: '12', number: '-' });
  });
});

describe('resolveBuyerHandleSchemeTag', () => {
  it('uses the tag the caller supplied', () => {
    expect(resolveBuyerHandleSchemeTag('EU-VAT', 'DE123456789')).toBe('eu-vat');
  });

  it('resolves the domestic case so one buyer keeps one handle whichever path issued', () => {
    expect(resolveBuyerHandleSchemeTag(undefined, '5213796333')).toBe('pl-nip');
  });

  it('never renders undefined into an identifier, whatever it is given', () => {
    expect(resolveBuyerHandleSchemeTag(undefined, 'DE123456789')).toBe('untagged');
    expect(resolveBuyerHandleSchemeTag('   ', '5213796333')).toBe('pl-nip');
  });
});

describe('toRegimeCalendarDate', () => {
  it('renders the calendar date the instant falls on in the regime, not in UTC', () => {
    expect(toRegimeCalendarDate(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
    expect(toRegimeCalendarDate(new Date('2026-09-15T21:30:00Z'))).toBe('2026-09-15');
  });

  it('answers null for an absent or unusable instant, so the vendor stamps its own date', () => {
    expect(toRegimeCalendarDate(undefined)).toBeNull();
    expect(toRegimeCalendarDate(new Date('not a date'))).toBeNull();
  });
});
