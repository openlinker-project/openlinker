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
import { BuyerProfile } from '@openlinker/core/invoicing';
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
  toCreateInvoiceRequest,
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
  return new BuyerProfile('Firma Polska sc.', taxId, address, taxId === null ? 'private' : 'company');
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

function compose(
  command: IssueInvoiceCommand = makeCommand(),
  config: EparagonyConnectionConfig = makeConfig(),
): ReturnType<typeof toCreateInvoiceRequest> {
  return toCreateInvoiceRequest({
    command,
    config,
    documentToken: DOCUMENT_TOKEN,
    transactionToken: TRANSACTION_TOKEN,
  });
}

/** Sum the per-rate map, whatever subset of codes it carries. */
function sumRateMap(map: Partial<Record<EparagonyInvoiceTaxRate, number>>): number {
  return Object.values(map).reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

describe('toCreateInvoiceRequest - the shape the live sandbox accepted', () => {
  it('reproduces the POC body field for field for a single 23% line', () => {
    const request = compose();

    expect(request.posId).toBe('openlinker');
    expect(request.documentToken).toBe(DOCUMENT_TOKEN);
    // Required whenever `documentToken` is sent; omitting it is a 400.
    expect(request.transactionToken).toBe(TRANSACTION_TOKEN);
    expect(request.eInvoice.invoiceType).toBe('VAT');
    expect(request.eInvoice.metadata).toMatchObject({
      vatCalculationMethod: 'SUM_OF_RATES_NET',
      calculationValidation: 'NONE',
      grossSaleValue: 9840,
      merchantTIN: '5252556107',
      netValueByTaxRate: { '23': 8000 },
      taxValueByTaxRate: { '23': 1840 },
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

describe('toCreateInvoiceRequest - the arithmetic reconciles exactly', () => {
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

  it('emits lines grouped by rate, in first-seen rate order, so the body is deterministic', () => {
    // Two identical commands must produce byte-identical bodies, or a replay of
    // the same idempotency key looks to the vendor like the same key with
    // different data.
    const lines: InvoiceLine[] = [
      { name: 'Alpha', quantity: 1, unitPriceGross: 12.3, taxRate: '23' },
      { name: 'Beta', quantity: 1, unitPriceGross: 10.5, taxRate: '5' },
      { name: 'Gamma', quantity: 1, unitPriceGross: 24.6, taxRate: '23' },
    ];
    const request = compose(makeCommand({ lines }));

    expect(request.eInvoice.lines.map((line) => line.productOrServiceName)).toEqual([
      'Alpha',
      'Gamma',
      'Beta',
    ]);
    expect(JSON.stringify(compose(makeCommand({ lines })))).toBe(JSON.stringify(request));
  });

  it("makes the LAST line of a group absorb the rounding residual", () => {
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

describe('toCreateInvoiceRequest - the buyer', () => {
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

describe('toCreateInvoiceRequest - the seller', () => {
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

describe('toCreateInvoiceRequest - optional metadata', () => {
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
    expect('saleEndDate' in compose(makeCommand({ saleDate: '15/09/2026' })).eInvoice.metadata).toBe(
      false,
    );
  });
});

describe('toCreateInvoiceRequest - refusals before anything is sent', () => {
  it('refuses a currency it would need an exchange rate for', () => {
    // ADR-040: OpenLinker's own FX stamp is analytics-only and must never
    // supply a fiscal document's rate, and there is no other source.
    expect(() => compose(makeCommand({ currency: 'EUR' }))).toThrow(EparagonyConfigException);
  });

  it("words the currency refusal so core resolves it to the currency failure code", () => {
    // `CURRENCY_REJECTION_MARKERS` is matched case-insensitively against the
    // adapter's own OL-authored reason - a reword here silently degrades the
    // operator's failure code to the generic one.
    try {
      compose(makeCommand({ currency: 'EUR' }));
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(EparagonyConfigException);
      expect((error as EparagonyConfigException).reason.toLowerCase()).toContain(
        'unsupported currency',
      );
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

  it('refuses a line whose rate is not an invoice rate in this regime', () => {
    expect(() =>
      compose(makeCommand({ lines: [{ name: 'X', quantity: 1, unitPriceGross: 10, taxRate: '7' }] })),
    ).toThrow(EparagonyConfigException);
  });

  it('refuses a line with no rate rather than substituting one', () => {
    try {
      compose(makeCommand({ lines: [{ name: 'X', quantity: 1, unitPriceGross: 10, taxRate: '' }] }));
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

  it("reports a CONFIRMED hub document as cleared, carrying the authority's own number", () => {
    // NOT observable in the sandbox - coded from the vendor's contract, where
    // `ksefNumber` is required at CONFIRMED and absent at OFFLINE.
    expect(toRegulatoryClearanceResult(CLEARED)).toEqual({
      regulatoryStatus: 'cleared',
      clearanceReference: '5265877635-20250626-010080DD2B5E-26',
    });
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
    expect(
      toRegulatoryClearanceResult({ ...OFFLINE, status: 'SOMETHING_NEW' }),
    ).toMatchObject({ regulatoryStatus: 'pending-submission' });
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

  it("supplies the scheme tag itself, because core holds a bare number and may not mint one", () => {
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
