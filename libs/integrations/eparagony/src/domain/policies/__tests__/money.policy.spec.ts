import { toMinorUnits, toQuantityString } from '../money.policy';

describe('money.policy', () => {
  describe('toMinorUnits', () => {
    it('should convert a decimal major amount to integer minor units', () => {
      expect(toMinorUnits(49.01)).toBe(4901);
      expect(toMinorUnits(0)).toBe(0);
    });

    it('should not lose a minor unit to binary float representation', () => {
      // 49.01 is 49.009999... in binary; truncation would understate the sale.
      expect(toMinorUnits(49.01)).toBe(4901);
      expect(toMinorUnits(1.005)).toBe(101);
    });

    it('should round a negative amount symmetrically when the amount is a rebate', () => {
      expect(toMinorUnits(-1.005)).toBe(-101);
    });

    it('should normalize negative zero when the amount rounds away', () => {
      expect(Object.is(toMinorUnits(-0.001), 0)).toBe(true);
    });

    it('should return null when the amount is not finite', () => {
      expect(toMinorUnits(Number.NaN)).toBeNull();
      expect(toMinorUnits(Number.POSITIVE_INFINITY)).toBeNull();
    });
  });

  describe('toQuantityString', () => {
    it('should render an integral quantity without trailing zeros', () => {
      expect(toQuantityString(1)).toBe('1');
      expect(toQuantityString(12)).toBe('12');
    });

    it('should keep fractional precision when the quantity is fractional', () => {
      expect(toQuantityString(1.234)).toBe('1.234');
    });

    it('should return null when the quantity is not registrable', () => {
      expect(toQuantityString(0)).toBeNull();
      expect(toQuantityString(-1)).toBeNull();
      expect(toQuantityString(Number.NaN)).toBeNull();
    });
  });
});
