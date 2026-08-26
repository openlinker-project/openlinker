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
import { toBridgeLines } from './subiekt-line.mapper';

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
