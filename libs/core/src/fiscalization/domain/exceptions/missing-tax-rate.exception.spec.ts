/**
 * Missing Fiscal Tax Rate Exception Tests (#2252)
 *
 * @module libs/core/src/fiscalization/domain/exceptions
 */
import { MissingFiscalTaxRateException } from './missing-tax-rate.exception';

describe('MissingFiscalTaxRateException', () => {
  it('should state the scope and name the first line', () => {
    const error = new MissingFiscalTaxRateException('ol_order_1', 1, 3, 'SKU-1');
    expect(error.message).toContain('1 of 3 lines carry no tax rate');
    expect(error.message).toContain('SKU-1');
  });

  it('should say the connection tax letter is not used to fill the gap', () => {
    // The whole point of the gate: the letter stops being a fallback, and the
    // operator has to be told so rather than wondering why it did nothing.
    const error = new MissingFiscalTaxRateException('ol_order_1', 1, 1, null);
    expect(error.message).toContain('tax letter is not used to fill the gap');
  });

  it('should carry only ids and counts, never buyer data', () => {
    const error = new MissingFiscalTaxRateException('ol_order_1', 2, 2, null);
    expect(error.orderId).toBe('ol_order_1');
    expect(error.lineCount).toBe(2);
    expect(error.totalLines).toBe(2);
    expect(error.firstLineName).toBeNull();
  });
});
