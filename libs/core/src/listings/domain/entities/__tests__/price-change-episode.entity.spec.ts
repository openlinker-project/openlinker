/**
 * Price Change Episode entity tests (#3159 review)
 *
 * Covers `deltaPct()` / `isSteep()`'s handling of a `null` `computedOldAmount`
 * — a brand-new mapping with no recorded baseline — which must read as an
 * UNKNOWN direction, never a fabricated "down" (the pre-#3159 `0`-sentinel
 * defect: `computedOldAmount === 0` short-circuited to `deltaPct() === 0`,
 * which the repository's direction filter then read as `'down'`).
 *
 * @module libs/core/src/listings/domain/entities/__tests__
 */
import { PriceChangeEpisode } from '../price-change-episode.entity';

function buildEpisode(
  computedOldAmount: number | null,
  computedNewAmount: number
): PriceChangeEpisode {
  return new PriceChangeEpisode(
    'ep-1',
    'ol_variant_1',
    'dest-1',
    'src-1',
    'PLN',
    350,
    327,
    computedOldAmount,
    computedNewAmount,
    null,
    null,
    null,
    new Date(),
    null,
    null,
    null,
    null,
    new Date(),
    new Date()
  );
}

describe('PriceChangeEpisode', () => {
  describe('deltaPct', () => {
    it('returns null (unknown direction) when computedOldAmount is null — a brand-new mapping', () => {
      expect(buildEpisode(null, 430.5).deltaPct()).toBeNull();
    });

    it('returns 0 for a real recorded zero baseline (a previously-free product), distinct from null', () => {
      expect(buildEpisode(0, 430.5).deltaPct()).toBe(0);
    });

    it('computes the percentage delta for a real baseline', () => {
      expect(buildEpisode(100, 90).deltaPct()).toBe(-10);
      expect(buildEpisode(100, 110).deltaPct()).toBe(10);
    });
  });

  describe('isSteep', () => {
    it('is never steep when the direction is unknown (null baseline)', () => {
      expect(buildEpisode(null, 430.5).isSteep()).toBe(false);
    });

    it('is steep at >= 10% magnitude', () => {
      expect(buildEpisode(100, 89).isSteep()).toBe(true);
      expect(buildEpisode(100, 91).isSteep()).toBe(false);
    });
  });

  describe('direction', () => {
    it('is unknown when computedOldAmount is null — a brand-new mapping', () => {
      expect(buildEpisode(null, 430.5).direction()).toBe('unknown');
    });

    it('is up for a real zero baseline with a positive new amount (#3159 review)', () => {
      // `deltaPct()` returns `0` here (to avoid a NaN/Infinity percentage),
      // but the direction must NOT read as 'down' — a price appearing where
      // there was none is an increase, not a decrease.
      expect(buildEpisode(0, 100).direction()).toBe('up');
    });

    it('is down when the new amount is lower than the baseline', () => {
      expect(buildEpisode(100, 90).direction()).toBe('down');
    });

    it('is up when the new amount is higher than the baseline', () => {
      expect(buildEpisode(100, 110).direction()).toBe('up');
    });
  });
});
