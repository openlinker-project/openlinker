import { describe, expect, it } from 'vitest';
import {
  BUYER_DATA_DEFAULT_RULES,
  daysToPeriod,
  globalRulesFromSettings,
  isValidPeriodDays,
  overrideFromRules,
  periodToDays,
  readBuyerDataSettings,
  resolveBuyerDataRules,
  validateBuyerDataRules,
  withBuyerDataSettings,
  wizardBuyerDataConfig,
} from './buyer-data-config';

describe('buyer data config (#4289)', () => {
  describe('isValidPeriodDays', () => {
    it.each([0, 30, 90, 365, 3650])('should accept %i days', (days) => {
      expect(isValidPeriodDays(days)).toBe(true);
    });
    it.each([-1, 1, 29, 3651, 45.5, Number.NaN])('should refuse %s days', (days) => {
      expect(isValidPeriodDays(days)).toBe(false);
    });
  });

  describe('validateBuyerDataRules', () => {
    it('should accept never for both questions', () => {
      expect(validateBuyerDataRules({ hideAfterDays: 0, eraseAfterDays: 0 })).toEqual([]);
    });
    it('should refuse an erase period shorter than the hide period', () => {
      expect(validateBuyerDataRules({ hideAfterDays: 90, eraseAfterDays: 60 })).toEqual([
        'erase-before-hide',
      ]);
    });
    it('should allow an erase period with hiding off', () => {
      expect(validateBuyerDataRules({ hideAfterDays: 0, eraseAfterDays: 30 })).toEqual([]);
    });
    it('should report out-of-range periods separately', () => {
      expect(validateBuyerDataRules({ hideAfterDays: 10, eraseAfterDays: 5000 })).toEqual([
        'hide-range',
        'erase-range',
      ]);
    });
  });

  describe('periods', () => {
    it('should speak a period in the largest exact unit', () => {
      expect(daysToPeriod(365)).toEqual({ amount: 1, unit: 'years' });
      expect(daysToPeriod(730)).toEqual({ amount: 2, unit: 'years' });
      expect(daysToPeriod(90)).toEqual({ amount: 3, unit: 'months' });
      expect(daysToPeriod(45)).toEqual({ amount: 45, unit: 'days' });
    });
    it('should convert a typed amount back to days', () => {
      expect(periodToDays(3, 'months')).toBe(90);
      expect(periodToDays(2, 'years')).toBe(730);
      expect(periodToDays(45, 'days')).toBe(45);
    });
  });

  describe('readBuyerDataSettings / withBuyerDataSettings', () => {
    it('should read an absent or null key as inherit', () => {
      expect(readBuyerDataSettings({})).toBeNull();
      expect(readBuyerDataSettings({ buyerDataRetention: null })).toBeNull();
      expect(readBuyerDataSettings(undefined)).toBeNull();
    });
    it('should keep only the fields stated validly', () => {
      expect(
        readBuyerDataSettings({
          buyerDataRetention: {
            enabled: true,
            hideAfterDays: 90,
            mode: 'nonsense',
            eraseAfterDays: '5',
          },
        })
      ).toEqual({ enabled: true, hideAfterDays: 90 });
    });
    it('should write inherit as an explicit null and keep every other key', () => {
      const next = withBuyerDataSettings(
        { baseUrl: 'x', buyerDataRetention: { enabled: true } },
        null
      );
      expect(next).toEqual({ baseUrl: 'x', buyerDataRetention: null });
      expect('buyerDataRetention' in next).toBe(true);
    });
  });

  describe('resolveBuyerDataRules', () => {
    const global = {
      enabled: true,
      hideAfterDays: 90,
      eraseAfterDays: 730,
      mode: 'personal-data' as const,
    };
    it('should inherit everything without an override', () => {
      expect(resolveBuyerDataRules(null, global)).toEqual(global);
    });
    it('should let an override field win and inherit the rest', () => {
      expect(resolveBuyerDataRules({ hideAfterDays: 0 }, global)).toEqual({
        ...global,
        hideAfterDays: 0,
      });
    });
  });

  describe('globalRulesFromSettings', () => {
    it('should fall back to the built-in rules when the API predates the knobs', () => {
      expect(globalRulesFromSettings(undefined)).toEqual(BUYER_DATA_DEFAULT_RULES);
      expect(globalRulesFromSettings({})).toEqual(BUYER_DATA_DEFAULT_RULES);
    });
    it('should read the resolved values', () => {
      expect(
        globalRulesFromSettings({
          buyerDataRetentionEnabled: { value: true },
          buyerDataHideAfterDays: { value: 90 },
          buyerDataEraseAfterDays: { value: 730 },
          buyerDataEraseMode: { value: 'whole-order' },
        })
      ).toEqual({ enabled: true, hideAfterDays: 90, eraseAfterDays: 730, mode: 'whole-order' });
    });
  });

  describe('wizardBuyerDataConfig', () => {
    it('should add nothing for general settings', () => {
      expect(wizardBuyerDataConfig({ choice: 'inherit', rules: null })).toEqual({});
      expect(wizardBuyerDataConfig(undefined)).toEqual({});
    });
    it('should store own rules switched off', () => {
      const rules = {
        enabled: true,
        hideAfterDays: 90,
        eraseAfterDays: 365,
        mode: 'personal-data' as const,
      };
      expect(wizardBuyerDataConfig({ choice: 'own', rules })).toEqual({
        buyerDataRetention: { ...overrideFromRules(rules), enabled: false },
      });
    });
  });
});
