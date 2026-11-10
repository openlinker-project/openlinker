/**
 * Delivery line - unit tests (#3905, ADR-082)
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import {
  combineReceiptLineNameLimits,
  FALLBACK_RECEIPT_LINE_NAME_LENGTH,
  formatReceiptLineName,
  maxDeliveryLineNameLength,
  readDeliveryOnDocuments,
  resolveDeliveryLine,
  spreadDeliveryAcrossLines,
  validateDeliveryOnDocumentsShape,
} from './delivery-line.types';

const config = {
  deliveryOnDocuments: {
    default: { name: 'Delivery', rate: 'goods' },
    countries: {
      ' pl ': {
        name: 'Koszt dostawy',
        invoiceName: 'Dostawa',
        rateFormat: 'labelled',
        rateLabel: 'TAX',
        methodNames: { 'inpost-locker': 'Paczkomat' },
      },
      DE: { name: 'Versand', rate: 'fixed', fixedRate: '19', freeDelivery: 'show' },
    },
  },
};

describe('formatReceiptLineName', () => {
  it('should format every rate style', () => {
    expect(formatReceiptLineName('Shipping', '23', 'plain')).toBe('Shipping 23%');
    expect(formatReceiptLineName('Shipping', '23', 'brackets')).toBe('Shipping (23%)');
    expect(formatReceiptLineName('Shipping', '23', 'labelled', 'TAX')).toBe('Shipping TAX 23%');
    expect(formatReceiptLineName('Shipping', '23', 'labelled')).toBe('Shipping 23%');
  });

  it('should spell one rate one way whatever the source wrote', () => {
    expect(formatReceiptLineName('Shipping', '23.00', 'plain')).toBe('Shipping 23%');
    expect(formatReceiptLineName('Shipping', '5.50', 'plain')).toBe('Shipping 5.5%');
  });

  it('should print a non-numeric code as it is', () => {
    expect(formatReceiptLineName('Shipping', 'zw', 'plain')).toBe('Shipping zw');
  });

  it('should return the bare name for a blank rate', () => {
    expect(formatReceiptLineName('Shipping', '', 'plain')).toBe('Shipping');
    expect(formatReceiptLineName('Shipping', null, 'labelled', 'TAX')).toBe('Shipping');
  });
});

describe('maxDeliveryLineNameLength', () => {
  it('should leave room for the suffix within the fallback budget when none is given', () => {
    expect(FALLBACK_RECEIPT_LINE_NAME_LENGTH).toBe(40);
    expect(maxDeliveryLineNameLength('plain')).toBe(36);
    expect(maxDeliveryLineNameLength('brackets')).toBe(34);
    expect(maxDeliveryLineNameLength('labelled', 'TAX')).toBe(32);
    expect(maxDeliveryLineNameLength('labelled')).toBe(36);
  });

  it('should leave room for the suffix within a declared budget when one is given', () => {
    expect(maxDeliveryLineNameLength('plain', undefined, 30)).toBe(26);
    expect(maxDeliveryLineNameLength('labelled', 'TAX', 30)).toBe(22);
  });
});

describe('combineReceiptLineNameLimits', () => {
  it('should report the fallback as undeclared when no adapter declares a budget', () => {
    expect(combineReceiptLineNameLimits([])).toEqual({
      maxLength: FALLBACK_RECEIPT_LINE_NAME_LENGTH,
      declared: false,
    });
  });

  it('should take the shortest budget when several adapters declare one', () => {
    expect(combineReceiptLineNameLimits([40, 32, 48])).toEqual({ maxLength: 32, declared: true });
  });

  it('should ignore a declaration that is not a positive whole number', () => {
    expect(combineReceiptLineNameLimits([0, -5, 12.5, Number.NaN, '20', null])).toEqual({
      maxLength: FALLBACK_RECEIPT_LINE_NAME_LENGTH,
      declared: false,
    });
    expect(combineReceiptLineNameLimits([0, 44])).toEqual({ maxLength: 44, declared: true });
  });
});

describe('readDeliveryOnDocuments', () => {
  it('should normalise country keys to trimmed upper case', () => {
    expect(Object.keys(readDeliveryOnDocuments(config)?.countries ?? {})).toEqual(['PL', 'DE']);
  });

  it('should return null when nothing usable is configured', () => {
    expect(readDeliveryOnDocuments(null)).toBeNull();
    expect(readDeliveryOnDocuments({})).toBeNull();
    expect(readDeliveryOnDocuments({ deliveryOnDocuments: 'x' })).toBeNull();
    expect(readDeliveryOnDocuments({ deliveryOnDocuments: { default: { name: ' ' } } })).toBeNull();
  });

  it('should drop a malformed row without losing its siblings', () => {
    const read = readDeliveryOnDocuments({
      deliveryOnDocuments: {
        countries: {
          PL: { name: 'Ok' },
          DE: { name: 'Bad', rate: 'fixed' },
          FRA: { name: 'Bad key' },
          CZ: { name: 'Bad enum', rateFormat: 'loud' },
        },
      },
    });
    expect(Object.keys(read?.countries ?? {})).toEqual(['PL']);
  });

  it('should apply defaults for absent enums', () => {
    const read = readDeliveryOnDocuments({ deliveryOnDocuments: { default: { name: 'X' } } });
    expect(read?.default).toMatchObject({
      rate: 'goods',
      freeDelivery: 'omit',
      rateFormat: 'plain',
    });
  });
});

describe('resolveDeliveryLine', () => {
  const read = readDeliveryOnDocuments(config);

  it('should default to Shipping, goods, plain with no config', () => {
    expect(resolveDeliveryLine(null, {})).toEqual({
      name: 'Shipping',
      invoiceName: 'Shipping',
      rate: 'goods',
      freeDelivery: 'omit',
      rateFormat: 'plain',
    });
  });

  it('should use the legacy name when no row applies', () => {
    expect(resolveDeliveryLine(null, { legacyName: 'Dostawa' }).name).toBe('Dostawa');
  });

  it('should prefer the country row over the default and the legacy name', () => {
    const line = resolveDeliveryLine(read, { countryIso2: 'pl', legacyName: 'Legacy' });
    expect(line).toMatchObject({
      name: 'Koszt dostawy',
      invoiceName: 'Dostawa',
      rateFormat: 'labelled',
      rateLabel: 'TAX',
    });
  });

  it('should prefer a per-method name inside the selected row', () => {
    expect(resolveDeliveryLine(read, { countryIso2: 'PL', methodId: 'inpost-locker' }).name).toBe(
      'Paczkomat',
    );
  });

  it('should not leak a default row method name into a country row', () => {
    expect(resolveDeliveryLine(read, { countryIso2: 'DE', methodId: 'inpost-locker' }).name).toBe(
      'Versand',
    );
  });

  it('should fall back to default for an unlisted country or none', () => {
    expect(resolveDeliveryLine(read, { countryIso2: 'FR' }).name).toBe('Delivery');
    expect(resolveDeliveryLine(read, {}).name).toBe('Delivery');
  });

  it('should carry the fixed rate and free-delivery choice', () => {
    expect(resolveDeliveryLine(read, { countryIso2: 'DE' })).toMatchObject({
      rate: 'fixed',
      fixedRate: '19',
      freeDelivery: 'show',
    });
  });
});

describe('validateDeliveryOnDocumentsShape', () => {
  it('should accept a valid value', () => {
    expect(validateDeliveryOnDocumentsShape(config.deliveryOnDocuments)).toEqual([]);
  });

  it('should refuse a non-object', () => {
    expect(validateDeliveryOnDocumentsShape('x')).toHaveLength(1);
  });

  it('should refuse a bad country key and a duplicate after normalising', () => {
    const issues = validateDeliveryOnDocumentsShape({
      countries: { POL: { name: 'A' }, pl: { name: 'A' }, ' PL': { name: 'A' } },
    });
    expect(issues.map((i) => i.message)).toEqual([
      'country key must be a two-letter ISO 3166 code',
      'duplicates another entry for PL',
    ]);
  });

  it('should refuse a blank name, a percentage and an over-long name', () => {
    expect(validateDeliveryOnDocumentsShape({ default: { name: ' ' } })).toHaveLength(1);
    expect(validateDeliveryOnDocumentsShape({ default: { name: 'TAX 23 %' } })[0]?.message).toMatch(
      /percentage/,
    );
    expect(
      validateDeliveryOnDocumentsShape({ default: { name: 'x'.repeat(33), rateFormat: 'labelled', rateLabel: 'TAX' } })[0]
        ?.message,
    ).toMatch(/at most 32/);
    expect(validateDeliveryOnDocumentsShape({ default: { name: 'x'.repeat(36) } })).toEqual([]);
  });

  it('should measure the name against a declared budget when the caller passes one', () => {
    expect(validateDeliveryOnDocumentsShape({ default: { name: 'x'.repeat(27) } }, 30)[0]?.message).toBe(
      'must be at most 26 characters so the name plus its rate fits 30',
    );
    expect(validateDeliveryOnDocumentsShape({ default: { name: 'x'.repeat(26) } }, 30)).toEqual([]);
  });

  it('should require a numeric fixedRate between 0 and 100 for fixed', () => {
    expect(
      validateDeliveryOnDocumentsShape({ default: { name: 'A', rate: 'fixed' } })[0]?.path,
    ).toBe('deliveryOnDocuments.default.fixedRate');
    expect(
      validateDeliveryOnDocumentsShape({ default: { name: 'A', rate: 'fixed', fixedRate: '101' } }),
    ).toHaveLength(1);
    expect(
      validateDeliveryOnDocumentsShape({ default: { name: 'A', rate: 'fixed', fixedRate: '0' } }),
    ).toEqual([]);
  });

  it('should refuse invalid enums and blank method names', () => {
    const issues = validateDeliveryOnDocumentsShape({
      default: {
        name: 'A',
        rate: 'magic',
        freeDelivery: 'maybe',
        rateFormat: 'loud',
        methodNames: { x: ' ' },
      },
    });
    expect(issues.map((i) => i.path)).toEqual(
      expect.arrayContaining([
        'deliveryOnDocuments.default.rate',
        'deliveryOnDocuments.default.freeDelivery',
        'deliveryOnDocuments.default.rateFormat',
        'deliveryOnDocuments.default.methodNames.x',
      ]),
    );
  });
});

describe('spreadDeliveryAcrossLines', () => {
  it('should allocate the amount exactly across lines', () => {
    const lines = [
      { unitPriceGross: 100, quantity: 1 },
      { unitPriceGross: 50, quantity: 1 },
    ];
    const inc = spreadDeliveryAcrossLines(15, lines, 2);
    expect(inc?.reduce((sum, v, i) => sum + v * lines[i].quantity, 0)).toBeCloseTo(15, 2);
  });

  it('should hand the remainder to a quantity-1 line', () => {
    const lines = [
      { unitPriceGross: 10, quantity: 3 },
      { unitPriceGross: 10, quantity: 1 },
    ];
    const inc = spreadDeliveryAcrossLines(0.1, lines, 2);
    expect(inc).not.toBeNull();
    expect(inc?.reduce((sum, v, i) => sum + v * lines[i].quantity, 0)).toBeCloseTo(0.1, 2);
  });

  it('should leave a gift line out of the allocation (goods 9.99 + gift 0.01 + shipping 15.00)', () => {
    const lines = [
      { unitPriceGross: 9.99, quantity: 1 },
      { unitPriceGross: 0.01, quantity: 1, isGift: true },
    ];
    const inc = spreadDeliveryAcrossLines(15, lines, 2);
    expect(inc).toEqual([15, 0]);
  });

  it('should return null when only gift lines could take the delivery', () => {
    expect(
      spreadDeliveryAcrossLines(15, [{ unitPriceGross: 0.01, quantity: 1, isGift: true }], 2),
    ).toBeNull();
  });

  it('should return null when no quantity-1 line can take the remainder', () => {
    expect(spreadDeliveryAcrossLines(0.1, [{ unitPriceGross: 10, quantity: 3 }], 2)).toBeNull();
  });

  it('should add nothing for a zero delivery', () => {
    expect(spreadDeliveryAcrossLines(0, [{ unitPriceGross: 10, quantity: 1 }], 2)).toEqual([0]);
  });
});
