/**
 * Neutral → FA(3) Builder-Input Mapper — Unit Specs
 *
 * Pins the empty-`taxRate` → connection-`defaultTaxRate` fallback (#1290):
 * an empty neutral rate resolves via the context's connection default; a
 * non-empty rate is never overridden (including a genuinely unmapped one,
 * which still throws); the same fallback applies to correction lines.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/domain
 */
import { BuyerProfile, type IssueInvoiceCommand } from '@openlinker/core/invoicing';
import {
  UnmappedTaxRateException,
  UnsupportedCountryCodeException,
} from '../../../domain/exceptions/fa3-builder.exception';
import { mapToFa3BuilderInput, type Fa3MappingContext } from './fa3-builder-input.mapper';
import { buildFa3Xml } from '../builders/fa3-xml.builder';
import { validateFa3Xml } from '../validators/fa3-xsd.validator';
import type { SellerProfile } from './fa3-xml.types';

const SELLER: SellerProfile = {
  nip: '1234567890',
  name: 'Acme Sp. z o.o.',
  address: { line1: 'ul. Testowa 1', line2: null, city: 'Warszawa', postalCode: '00-001', countryIso2: 'PL' },
};

const CONTEXT: Fa3MappingContext = {
  seller: SELLER,
  issueDate: '2026-07-01',
  generatedAt: '2026-07-01T00:00:00.000Z',
  invoiceNumber: 'ol_order_test_001',
  defaultTaxRate: '8',
};

function baseCommand(taxRate: string): IssueInvoiceCommand {
  return {
    connectionId: 'conn-1',
    orderId: 'ol_order_test_001',
    buyer: new BuyerProfile(
      'Jan Kowalski',
      null,
      { line1: 'ul. Kupiecka 2', line2: null, city: 'Kraków', postalCode: '30-001', countryIso2: 'PL' },
      'private',
    ),
    currency: 'PLN',
    lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 100, taxRate }],
  };
}

describe('mapToFa3BuilderInput — tax-rate fallback', () => {
  it('should resolve an empty neutral taxRate to the seller defaultTaxRate', () => {
    const result = mapToFa3BuilderInput(baseCommand(''), CONTEXT);
    expect(result.lines[0].p12).toBe('8');
  });

  it('should not override an explicit, mapped neutral taxRate with the default', () => {
    const result = mapToFa3BuilderInput(baseCommand('23'), CONTEXT);
    expect(result.lines[0].p12).toBe('23');
  });

  it('should still throw UnmappedTaxRateException for a non-empty unmapped taxRate', () => {
    expect(() => mapToFa3BuilderInput(baseCommand('bogus'), CONTEXT)).toThrow(
      UnmappedTaxRateException,
    );
  });

  it('should apply the same fallback to correction lines', () => {
    const cmd = baseCommand('23');
    cmd.correction = {
      originalClearanceReference: null,
      originalDocumentNumber: 'FA/2026/06/0001',
      originalIssueDate: '2026-06-01',
      reason: 'Return',
      correctedLines: [{ name: 'Widget', quantity: 1, unitPriceGross: 90, taxRate: '' }],
    };

    const result = mapToFa3BuilderInput(cmd, CONTEXT);

    expect(result.correction?.correctedLines[0].p12).toBe('8');
  });
});

describe('mapToFa3BuilderInput - country-code normalisation', () => {
  function commandWithBuyerCountry(countryIso2: string): IssueInvoiceCommand {
    const cmd = baseCommand('23');
    return {
      ...cmd,
      buyer: new BuyerProfile(
        cmd.buyer.name,
        cmd.buyer.taxId,
        { ...cmd.buyer.address, countryIso2 },
        cmd.buyer.type,
      ),
    };
  }

  it('should uppercase a lowercase buyer countryIso2 when it is a TKodKraju member', () => {
    const result = mapToFa3BuilderInput(commandWithBuyerCountry('pl'), CONTEXT);
    expect(result.buyerAddress.countryIso2).toBe('PL');
  });

  it('should normalise the seller address countryIso2 as well', () => {
    const context: Fa3MappingContext = {
      ...CONTEXT,
      seller: { ...SELLER, address: { ...SELLER.address, countryIso2: 'pl' } },
    };
    const result = mapToFa3BuilderInput(baseCommand('23'), context);
    expect(result.seller.address.countryIso2).toBe('PL');
  });

  it('should throw UnsupportedCountryCodeException when the buyer countryIso2 is outside the enumeration', () => {
    expect(() => mapToFa3BuilderInput(commandWithBuyerCountry('xx'), CONTEXT)).toThrow(
      UnsupportedCountryCodeException,
    );
  });
});

describe('mapToFa3BuilderInput — payment (#1311)', () => {
  it('should NOT set payment on the builder input when the context has none', () => {
    const result = mapToFa3BuilderInput(baseCommand('23'), CONTEXT);
    expect(result.payment).toBeUndefined();
    expect('payment' in result).toBe(false);
  });

  it('should pass the context payment through to the builder input unchanged', () => {
    const context: Fa3MappingContext = {
      ...CONTEXT,
      payment: { formaPlatnosci: '6', paymentTermDays: 14 },
    };
    const result = mapToFa3BuilderInput(baseCommand('23'), context);
    expect(result.payment).toEqual({ formaPlatnosci: '6', paymentTermDays: 14 });
  });
});

describe('mapToFa3BuilderInput - sale date P_6 (#1525)', () => {
  it('should pass the neutral saleDate through to the builder input', () => {
    const result = mapToFa3BuilderInput({ ...baseCommand('23'), saleDate: '2026-06-20' }, CONTEXT);
    expect(result.saleDate).toBe('2026-06-20');
  });

  it('should leave saleDate off the builder input when the command has none', () => {
    const result = mapToFa3BuilderInput(baseCommand('23'), CONTEXT);
    expect(result.saleDate).toBeUndefined();
    expect('saleDate' in result).toBe(false);
  });
});

describe('mapToFa3BuilderInput - line unit P_8A precedence (#1525)', () => {
  it('should keep the line unit when the neutral line carries one (wins over the default)', () => {
    const cmd = baseCommand('23');
    cmd.lines = [{ name: 'Widget', quantity: 1, unitPriceGross: 100, taxRate: '23', unit: 'kg' }];
    const result = mapToFa3BuilderInput(cmd, { ...CONTEXT, defaultLineUnit: 'szt.' });
    expect(result.lines[0].unit).toBe('kg');
  });

  it('should fall back to the connection defaultLineUnit when the line has none', () => {
    const result = mapToFa3BuilderInput(baseCommand('23'), { ...CONTEXT, defaultLineUnit: 'szt.' });
    expect(result.lines[0].unit).toBe('szt.');
  });

  it('should omit unit entirely when neither the line nor the connection has one', () => {
    const result = mapToFa3BuilderInput(baseCommand('23'), CONTEXT);
    expect(result.lines[0].unit).toBeUndefined();
    expect('unit' in result.lines[0]).toBe(false);
  });

  it('should treat an empty/whitespace line unit as absent and use the default', () => {
    const cmd = baseCommand('23');
    cmd.lines = [{ name: 'Widget', quantity: 1, unitPriceGross: 100, taxRate: '23', unit: '  ' }];
    const result = mapToFa3BuilderInput(cmd, { ...CONTEXT, defaultLineUnit: 'kpl.' });
    expect(result.lines[0].unit).toBe('kpl.');
  });

  it('should apply the same unit precedence to correction lines', () => {
    const cmd = baseCommand('23');
    cmd.correction = {
      originalClearanceReference: null,
      originalDocumentNumber: 'FA/2026/06/0001',
      originalIssueDate: '2026-06-01',
      reason: 'Return',
      correctedLines: [{ name: 'Widget', quantity: 1, unitPriceGross: 90, taxRate: '23' }],
    };
    const result = mapToFa3BuilderInput(cmd, { ...CONTEXT, defaultLineUnit: 'szt.' });
    expect(result.correction?.correctedLines[0].unit).toBe('szt.');
  });
});

describe('mapToFa3BuilderInput - per-line GTU / Procedura (#1586)', () => {
  it('should forward gtuCode and procedureCode onto the mapped line', () => {
    const cmd = baseCommand('23');
    cmd.lines = [
      { name: 'Widget', quantity: 1, unitPriceGross: 100, taxRate: '23', gtuCode: 'GTU_01', procedureCode: 'SW' },
    ];
    const result = mapToFa3BuilderInput(cmd, CONTEXT);
    expect(result.lines[0].gtuCode).toBe('GTU_01');
    expect(result.lines[0].procedureCode).toBe('SW');
  });

  it('should omit both when the neutral line carries neither', () => {
    const result = mapToFa3BuilderInput(baseCommand('23'), CONTEXT);
    expect('gtuCode' in result.lines[0]).toBe(false);
    expect('procedureCode' in result.lines[0]).toBe(false);
  });

  it('should treat empty/whitespace codes as absent (no connection default)', () => {
    const cmd = baseCommand('23');
    cmd.lines = [
      { name: 'Widget', quantity: 1, unitPriceGross: 100, taxRate: '23', gtuCode: '  ', procedureCode: '' },
    ];
    const result = mapToFa3BuilderInput(cmd, CONTEXT);
    expect('gtuCode' in result.lines[0]).toBe(false);
    expect('procedureCode' in result.lines[0]).toBe(false);
  });

  it('should forward the codes onto correction lines too', () => {
    const cmd = baseCommand('23');
    cmd.correction = {
      originalClearanceReference: null,
      originalDocumentNumber: 'FA/2026/06/0001',
      originalIssueDate: '2026-06-01',
      reason: 'Return',
      correctedLines: [
        { name: 'Widget', quantity: 1, unitPriceGross: 90, taxRate: '23', gtuCode: 'GTU_07' },
      ],
    };
    const result = mapToFa3BuilderInput(cmd, CONTEXT);
    expect(result.correction?.correctedLines[0].gtuCode).toBe('GTU_07');
  });
});

describe('mixed-rate order -> correctly-split FA(3) band breakdown (#1586 acceptance)', () => {
  it('should flow distinct per-line neutral rates through to the P_13/P_14 band split', () => {
    const cmd = baseCommand('23');
    // Two lines at different genuine per-line rates (23% + 8%) - the exact
    // mixed-rate case that a single flat connection default would mis-tax.
    cmd.lines = [
      { name: 'Standard-rate good', quantity: 1, unitPriceGross: 123, taxRate: '23' },
      { name: 'Reduced-rate good', quantity: 1, unitPriceGross: 108, taxRate: '8' },
    ];
    const mapped = mapToFa3BuilderInput(cmd, CONTEXT);
    // Mapping seam: each line resolves to its OWN P_12, not the connection default.
    expect(mapped.lines.map((l) => l.p12)).toEqual(['23', '8']);

    const xml = buildFa3Xml(mapped);
    // 23% line: net 100.00 -> P_13_1, VAT 23.00 -> P_14_1.
    expect(xml).toContain('<P_13_1>100.00</P_13_1>');
    expect(xml).toContain('<P_14_1>23.00</P_14_1>');
    // 8% line: net 100.00 -> P_13_2, VAT 8.00 -> P_14_2.
    expect(xml).toContain('<P_13_2>100.00</P_13_2>');
    expect(xml).toContain('<P_14_2>8.00</P_14_2>');
    expect(() => validateFa3Xml(xml)).not.toThrow();
  });
});
