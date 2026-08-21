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

  it('should refuse an empty rate rather than defaulting it (#2257)', () => {
    // INVERTED deliberately: the 23% default this used to assert is what the
    // epic removes. The bridge would reject the line anyway ("StawkaVAT jest
    // wymagana"); the difference is that the failure now names the product.
    expect(() => toBridgeLines([line('')])).toThrow(MissingTaxRateException);
    expect(() => toBridgeLines([line('   ')])).toThrow(MissingTaxRateException);
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
