import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MONEY_BASIS,
  averageOrderValueForBasis,
  medianOrderValueForBasis,
  parseMoneyBasis,
  revenueForBasis,
  revenueLabelForBasis,
} from './money-basis.lib';

describe('money-basis.lib', () => {
  describe('DEFAULT_MONEY_BASIS', () => {
    it('should be net — see the module doc comment for why this deviates from a naive "default is gross" reading', () => {
      expect(DEFAULT_MONEY_BASIS).toBe('net');
    });
  });

  describe('parseMoneyBasis', () => {
    it('should return net when the URL carries no basis param', () => {
      expect(parseMoneyBasis(null)).toBe('net');
    });

    it('should return gross when the URL explicitly requests it', () => {
      expect(parseMoneyBasis('gross')).toBe('gross');
    });

    it('should fall back to net for any unrecognized value, never throwing', () => {
      expect(parseMoneyBasis('garbage')).toBe('net');
      expect(parseMoneyBasis('')).toBe('net');
    });
  });

  describe('revenueForBasis', () => {
    const amount = { revenue: 1230, netRevenue: 1000 };

    it('should pick the gross revenue field under gross', () => {
      expect(revenueForBasis(amount, 'gross')).toBe(1230);
    });

    it('should pick the net revenue field under net', () => {
      expect(revenueForBasis(amount, 'net')).toBe(1000);
    });
  });

  describe('averageOrderValueForBasis', () => {
    it('should pick the matching field per basis, including a null gross figure', () => {
      const amount = { averageOrderValue: null, netAverageOrderValue: 107.5 };
      expect(averageOrderValueForBasis(amount, 'gross')).toBeNull();
      expect(averageOrderValueForBasis(amount, 'net')).toBe(107.5);
    });
  });

  describe('medianOrderValueForBasis', () => {
    it('should pick the matching field per basis', () => {
      const amount = { medianOrderValue: 120, netMedianOrderValue: 90 };
      expect(medianOrderValueForBasis(amount, 'gross')).toBe(120);
      expect(medianOrderValueForBasis(amount, 'net')).toBe(90);
    });
  });

  describe('revenueLabelForBasis', () => {
    it('should label gross as GMV and net as Net sales', () => {
      expect(revenueLabelForBasis('gross')).toBe('GMV');
      expect(revenueLabelForBasis('net')).toBe('Net sales');
    });
  });
});
