/**
 * Subiekt Line Mapper Tests — tax-rate notation (#2247)
 *
 * The bridge takes the neutral code through as a Polish rate symbol, so the
 * only thing that can go wrong here is notation. A fractional spelling must
 * not reach Subiekt, where `'0.23'` is neither a symbol it knows nor a rate
 * anyone declared.
 *
 * @module libs/integrations/subiekt/src/infrastructure/mappers
 */
import type { InvoiceLine } from '@openlinker/core/invoicing';
import { FractionalTaxRateNotationError, MissingTaxRateException } from '@openlinker/core/invoicing';
import {
  expandStockComponents,
  remapCorrectionLinesToExpandedDocument,
  toBridgeLines,
} from './subiekt-line.mapper';

function line(taxRate: string): InvoiceLine {
  return { name: 'Widget', quantity: 1, unitPriceGross: 123, taxRate };
}

describe('toBridgeLines', () => {
  it('should send 23 as the rate symbol when the neutral code is "23"', () => {
    expect(toBridgeLines([line('23')])[0]?.stawkaVAT).toBe('23');
  });

  it('should pass a zero rate through rather than defaulting it', () => {
    expect(toBridgeLines([line('0')])[0]?.stawkaVAT).toBe('0');
  });

  it('should pass an exemption code through unchanged', () => {
    expect(toBridgeLines([line('zw')])[0]?.stawkaVAT).toBe('zw');
  });

  describe('an empty rate (#2257, gated by #2260 review)', () => {
    const withStrict = (value: string | undefined, run: () => void) => () => {
      const previous = process.env['OL_TAX_RATE_STRICT_ENABLED'];
      if (value === undefined) delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
      else process.env['OL_TAX_RATE_STRICT_ENABLED'] = value;
      try {
        run();
      } finally {
        if (previous === undefined) delete process.env['OL_TAX_RATE_STRICT_ENABLED'];
        else process.env['OL_TAX_RATE_STRICT_ENABLED'] = previous;
      }
    };

    it(
      'should substitute the documented default while the switch is off - the default',
      withStrict(undefined, () => {
        // Catalogue coverage is zero on deploy, so removing the default outright
        // would refuse 100% of issuance on day one. It survives until an
        // operator opts in.
        expect(toBridgeLines([line('')])[0]?.stawkaVAT).toBe('23');
        expect(toBridgeLines([line('   ')])[0]?.stawkaVAT).toBe('23');
      }),
    );

    it(
      'should refuse rather than defaulting when the switch is on',
      withStrict('true', () => {
        // The bridge would reject the line anyway ("StawkaVAT jest wymagana");
        // the difference is that the failure now names the product.
        expect(() => toBridgeLines([line('')])).toThrow(MissingTaxRateException);
        expect(() => toBridgeLines([line('   ')])).toThrow(MissingTaxRateException);
      }),
    );

    it(
      'should exempt a PRE-ROLLOUT order even with the switch on (#2260 review)',
      withStrict('true', () => {
        // Core's own guard lets a pre-rollout order through, so refusing it here
        // made this route disagree with inFakt and KSeF for the same order.
        expect(toBridgeLines([line('')], 'pre-rollout')[0]?.stawkaVAT).toBe('23');
      }),
    );

    it(
      'should still refuse when the era marker is unrecognised (#2260 review)',
      withStrict('true', () => {
        expect(() => toBridgeLines([line('')], 'legacy')).toThrow(MissingTaxRateException);
      }),
    );
  });

  it('should reject a fractional-looking rate rather than forwarding it', () => {
    expect(() => toBridgeLines([line('0.23')])).toThrow(FractionalTaxRateNotationError);
  });

  it('should carry the line name, quantity and gross unit price through unchanged', () => {
    expect(toBridgeLines([line('23')])[0]).toEqual({
      name: 'Widget',
      ilosc: 1,
      cenaBrutto: 123,
      stawkaVAT: '23',
    });
  });
});

describe('expandStockComponents (#3607)', () => {
  const line = {
    name: 'Zestaw',
    quantity: 1,
    unitPriceGross: 59.9,
    taxRate: '23',
    productId: 'p-set',
    variantId: 'v-set',
    stockComponents: [
      { productId: 'p-mug', variantId: 'v-mug', quantity: 1, name: 'Kubek' },
      { productId: 'p-pad', variantId: 'v-pad', quantity: 1, name: 'Podkladka' },
    ],
  };

  it('replaces a bundle line with its components, summing to the paid total', () => {
    const out = expandStockComponents([line]);
    expect(out.map((l) => l.productId)).toEqual(['p-mug', 'p-pad']);
    expect(out.reduce((s, l) => s + l.unitPriceGross * l.quantity, 0)).toBeCloseTo(59.9, 2);
    expect(out.every((l) => l.stockComponents === undefined)).toBe(true);
  });

  it('sells a gift slot at zero', () => {
    const out = expandStockComponents([
      {
        ...line,
        stockComponents: [
          { productId: 'p-mug', variantId: 'v-mug', quantity: 1, name: 'Kubek' },
          { productId: 'p-g', variantId: 'v-g', quantity: 1, name: 'Gratis', giftSlot: true },
        ],
      },
    ]);
    expect(out.map((l) => l.unitPriceGross)).toEqual([59.9, 0]);
  });

  it('leaves a line without components untouched', () => {
    const plain = { name: 'Kubek', quantity: 2, unitPriceGross: 10, taxRate: '23', productId: 'p-mug' };
    expect(expandStockComponents([plain])).toEqual([plain]);
  });
});

describe('expandStockComponents - core-computed shares', () => {
  it('books the value core assigned each component, not a split by unit count', () => {
    const out = expandStockComponents(
      [
        {
          name: 'Zestaw',
          quantity: 1,
          unitPriceGross: 90,
          taxRate: '23',
          productId: 'p-set',
          stockComponents: [
            { productId: 'p-mug', variantId: 'v-mug', quantity: 1, name: 'Kubek', totalGross: 85.71 },
            { productId: 'p-pad', variantId: 'v-pad', quantity: 1, name: 'Podkladka', totalGross: 4.29 },
          ],
        },
      ],
      'PLN',
    );
    expect(out.map((l) => l.unitPriceGross)).toEqual([85.71, 4.29]);
  });
});

describe('remapCorrectionLinesToExpandedDocument', () => {
  const plain = (name: string): InvoiceLine => ({ name, quantity: 1, unitPriceGross: 10, taxRate: '23', productId: name });
  const set: InvoiceLine = {
    name: 'Zestaw',
    quantity: 2,
    unitPriceGross: 50,
    taxRate: '23',
    productId: 'p-set',
    stockComponents: [
      { productId: 'p-mug', variantId: 'v-mug', quantity: 2 },
      { productId: 'p-pad', variantId: 'v-pad', quantity: 2 },
    ],
  };

  it('shifts the positions after a set line by the components it expanded into', () => {
    const out = remapCorrectionLinesToExpandedDocument(
      [{ originalLineNumber: 2, newQuantity: 0 }],
      [set, plain('kawa')],
    );
    expect(out).toEqual([{ originalLineNumber: 3, newQuantity: 0 }]);
  });

  it('spreads a set quantity change over its component lines', () => {
    const out = remapCorrectionLinesToExpandedDocument([{ originalLineNumber: 1, newQuantity: 1 }], [set, plain('kawa')]);
    expect(out).toEqual([
      { originalLineNumber: 1, newQuantity: 1 },
      { originalLineNumber: 2, newQuantity: 1 },
    ]);
  });

  it('keeps the positions when no set was expanded', () => {
    const corrections = [{ originalLineNumber: 2, newQuantity: 0 }];
    expect(remapCorrectionLinesToExpandedDocument(corrections, [plain('a'), plain('b')])).toEqual(corrections);
  });

  it('refuses a price correction on a set line instead of guessing a position', () => {
    expect(() =>
      remapCorrectionLinesToExpandedDocument([{ originalLineNumber: 1, newUnitPriceGross: 40 }], [set]),
    ).toThrow(/set sold as its components/);
  });
});
