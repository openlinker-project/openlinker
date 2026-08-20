import {
  EPARAGONY_DEFAULT_TAX_RATES,
  resolveTaxRateCode,
  resolveTaxRateTable,
} from '../tax-rate.policy';

describe('tax-rate.policy', () => {
  describe('resolveTaxRateTable', () => {
    it('should return the default slot table when the connection configures none', () => {
      expect(resolveTaxRateTable(undefined)).toEqual(EPARAGONY_DEFAULT_TAX_RATES);
    });

    it('should merge a partial override over the defaults when some slots are configured', () => {
      const table = resolveTaxRateTable({ B: '7' });
      expect(table.B).toBe('7');
      expect(table.A).toBe(EPARAGONY_DEFAULT_TAX_RATES.A);
    });

    it('should ignore a blank override when the operator submitted whitespace', () => {
      expect(resolveTaxRateTable({ A: '   ' }).A).toBe(EPARAGONY_DEFAULT_TAX_RATES.A);
    });
  });

  describe('resolveTaxRateCode', () => {
    const table = resolveTaxRateTable(undefined);

    it('should pass a bare slot letter through when the line already carries one', () => {
      expect(resolveTaxRateCode('A', table)).toBe('A');
      expect(resolveTaxRateCode('e', table)).toBe('E');
    });

    it('should match a percentage numerically when formatting differs', () => {
      expect(resolveTaxRateCode('23', table)).toBe('A');
      expect(resolveTaxRateCode('23.00', table)).toBe('A');
      expect(resolveTaxRateCode('23%', table)).toBe('A');
    });

    it('should match an exemption marker when the slot carries one', () => {
      expect(resolveTaxRateCode('zw', table)).toBe('E');
    });

    it('should resolve to the operator-declared slot when the line carries no rate', () => {
      // OL never infers a rate; the operator declared this slot per connection.
      expect(resolveTaxRateCode('', table, 'B')).toBe('B');
    });

    it('should block when the line carries no rate and no default is declared', () => {
      expect(resolveTaxRateCode('', table)).toBeNull();
    });

    it('should block when the rate matches no configured slot', () => {
      expect(resolveTaxRateCode('17', table)).toBeNull();
      expect(resolveTaxRateCode('Z', table)).toBeNull();
    });

    it('should not treat an unresolvable rate as zero when a zero slot exists', () => {
      // The empty string means "OL resolved none", never "the rate is zero".
      expect(resolveTaxRateCode('', table)).not.toBe('D');
    });
  });
});
