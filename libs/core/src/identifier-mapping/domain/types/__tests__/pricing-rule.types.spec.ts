/**
 * Pricing Rule helper tests (#1843)
 *
 * @module libs/core/src/identifier-mapping/domain/types/__tests__
 */
import {
  applyPricingRule,
  readPricingRule,
  readPricingRuleConfig,
  readPricingRuleForSource,
} from '../pricing-rule.types';

describe('pricing-rule', () => {
  describe('readPricingRule', () => {
    it('should return null when config is null or undefined', () => {
      expect(readPricingRule(null)).toBeNull();
      expect(readPricingRule(undefined)).toBeNull();
    });

    it('should return null when the key is absent (backward compatible passthrough)', () => {
      expect(readPricingRule({})).toBeNull();
      expect(readPricingRule({ masterCatalogConnectionId: 'c1' })).toBeNull();
    });

    it('should return null for a non-object or unrecognized type', () => {
      expect(readPricingRule({ pricingRule: 'markup' as unknown as never })).toBeNull();
      expect(readPricingRule({ pricingRule: { type: 'bogus' } as unknown as never })).toBeNull();
    });

    it('should read a valid markup rule', () => {
      expect(readPricingRule({ pricingRule: { type: 'markup', percent: 20 } })).toEqual({
        type: 'markup',
        percent: 20,
        rounding: 'none',
      });
    });

    it('should read a valid margin rule with rounding', () => {
      expect(
        readPricingRule({ pricingRule: { type: 'margin', percent: 30, rounding: 'endingIn99' } })
      ).toEqual({ type: 'margin', percent: 30, rounding: 'endingIn99' });
    });

    it('should coerce a non-numeric/non-finite percent to 0', () => {
      expect(
        readPricingRule({
          pricingRule: { type: 'markup', percent: '20' as unknown as number },
        })
      ).toEqual({
        type: 'markup',
        percent: 0,
        rounding: 'none',
      });
      expect(readPricingRule({ pricingRule: { type: 'markup', percent: Number.NaN } })).toEqual({
        type: 'markup',
        percent: 0,
        rounding: 'none',
      });
    });

    it('should coerce an unrecognized rounding mode to none', () => {
      expect(
        readPricingRule({
          pricingRule: { type: 'passthrough', rounding: 'bogus' as unknown as 'none' },
        })
      ).toEqual({ type: 'passthrough', percent: 0, rounding: 'none' });
    });
  });

  describe('applyPricingRule', () => {
    it('should return the base price completely unchanged when no rule is configured', () => {
      expect(applyPricingRule(49.999, null)).toBe(49.999);
    });

    it('should apply a passthrough rule with default (none) rounding as 2dp cleanup', () => {
      expect(applyPricingRule(49.999, { type: 'passthrough' })).toBe(50);
    });

    it('should apply a markup percentage on top of the base price', () => {
      expect(applyPricingRule(100, { type: 'markup', percent: 20 })).toBe(120);
      expect(applyPricingRule(100, { type: 'markup', percent: -10 })).toBe(90);
    });

    it('should apply a margin percentage solving for price over the base cost', () => {
      // margin 20% => price = 100 / 0.8 = 125
      expect(applyPricingRule(100, { type: 'margin', percent: 20 })).toBe(125);
    });

    it('should degrade a margin >= 100% to the base price (undefined formula guard)', () => {
      expect(applyPricingRule(100, { type: 'margin', percent: 100 })).toBe(100);
      expect(applyPricingRule(100, { type: 'margin', percent: 150 })).toBe(100);
    });

    it('should round to the nearest whole unit when rounding=nearestWhole', () => {
      expect(
        applyPricingRule(100, { type: 'markup', percent: 12.3, rounding: 'nearestWhole' })
      ).toBe(112);
    });

    it('should round up to the next whole unit minus a cent when rounding=endingIn99', () => {
      expect(applyPricingRule(19.3, { type: 'passthrough', rounding: 'endingIn99' })).toBe(19.99);
      expect(applyPricingRule(20, { type: 'passthrough', rounding: 'endingIn99' })).toBe(19.99);
      expect(applyPricingRule(19.99, { type: 'passthrough', rounding: 'endingIn99' })).toBe(19.99);
    });

    it('should never return a negative price', () => {
      expect(applyPricingRule(0.001, { type: 'passthrough', rounding: 'endingIn99' })).toBeGreaterThanOrEqual(0);
    });
  });

  // #3142 — default + per-source-override shape (ADR-072 decision 2).
  describe('readPricingRuleForSource', () => {
    const MARKUP_DEFAULT = { type: 'markup' as const, percent: 20 };
    const MARGIN_OVERRIDE = { type: 'margin' as const, percent: 30, rounding: 'endingIn99' as const };

    it('should resolve the source override when one is configured', () => {
      const config = {
        pricingRule: {
          default: MARKUP_DEFAULT,
          sourceOverrides: { 'src-1': MARGIN_OVERRIDE },
        },
      };
      expect(readPricingRuleForSource(config, 'src-1')).toEqual({
        type: 'margin',
        percent: 30,
        rounding: 'endingIn99',
      });
    });

    it('should fall back to the default when no override exists for the source', () => {
      const config = {
        pricingRule: { default: MARKUP_DEFAULT, sourceOverrides: { 'src-1': MARGIN_OVERRIDE } },
      };
      expect(readPricingRuleForSource(config, 'src-2')).toEqual({
        type: 'markup',
        percent: 20,
        rounding: 'none',
      });
    });

    it('should read a legacy flat-shape config as the default with no overrides', () => {
      const config = { pricingRule: { type: 'markup' as const, percent: 15 } };
      expect(readPricingRuleForSource(config, 'any-source')).toEqual({
        type: 'markup',
        percent: 15,
        rounding: 'none',
      });
      expect(readPricingRule(config)).toEqual({ type: 'markup', percent: 15, rounding: 'none' });
      expect(readPricingRuleConfig(config).sourceOverrides).toEqual({});
    });

    it('should return null for both default and any source when nothing is configured', () => {
      expect(readPricingRuleForSource({}, 'src-1')).toBeNull();
      expect(readPricingRuleForSource(null, 'src-1')).toBeNull();
    });

    it('should ignore an unrecognized override value rather than throwing', () => {
      const config = {
        pricingRule: {
          default: MARKUP_DEFAULT,
          sourceOverrides: { 'src-1': { type: 'bogus' } as unknown as never },
        },
      };
      expect(readPricingRuleForSource(config, 'src-1')).toEqual({
        type: 'markup',
        percent: 20,
        rounding: 'none',
      });
    });

    // Piotr's PR #3158 review, BLOCKING: a headless `{ sourceOverrides }`
    // container (no `default` key) must still resolve via the nested-shape
    // branch, or every override in it is silently discarded on read.
    it('should read sourceOverrides even when the container carries no `default` key', () => {
      const config = {
        pricingRule: {
          sourceOverrides: { 'src-1': MARGIN_OVERRIDE },
        },
      };
      expect(readPricingRuleConfig(config)).toEqual({
        default: null,
        sourceOverrides: { 'src-1': { type: 'margin', percent: 30, rounding: 'endingIn99' } },
      });
      expect(readPricingRuleForSource(config, 'src-1')).toEqual({
        type: 'margin',
        percent: 30,
        rounding: 'endingIn99',
      });
      // No default and no override for this source ⇒ null, not a mis-read of
      // the container itself as a legacy flat rule.
      expect(readPricingRuleForSource(config, 'src-2')).toBeNull();
    });
  });
});
