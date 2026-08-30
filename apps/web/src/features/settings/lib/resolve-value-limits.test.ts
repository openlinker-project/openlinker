/**
 * Resolve Value Limits — unit tests
 *
 * The degradation cases matter as much as the happy one here: this page is
 * rendered against a live API by an operator, and a response missing a block
 * must produce a usable control rather than a thrown render.
 *
 * @module apps/web/src/features/settings/lib
 */
import { describe, expect, it } from 'vitest';
import { isAboveRecommended, resolveValueLimits } from './resolve-value-limits';

const RESOLVED = {
  value: 500,
  source: 'default' as const,
  recommendedMax: 2000,
  recommendedReason: 'Past this the queue deepens.',
  absoluteMax: 20_000,
  absoluteReason: 'A sanity backstop.',
  aboveRecommended: false,
};

const BOUND = {
  min: 1,
  recommendedMax: 2000,
  absoluteMax: 20_000,
  default: 500,
  envVar: 'OL_PRODUCT_SYNC_PAGE_LIMIT',
};

describe('resolveValueLimits', () => {
  it('should read both ceilings and both reasons off the value', () => {
    const limits = resolveValueLimits(RESOLVED, BOUND);

    expect(limits.recommendedMax).toBe(2000);
    expect(limits.absoluteMax).toBe(20_000);
    expect(limits.recommendedReason).toBe('Past this the queue deepens.');
    expect(limits.complete).toBe(true);
  });

  it('should range the control to the absolute ceiling, not the recommendation', () => {
    // Stopping at the recommendation would make the raised ceiling
    // unreachable, which is the whole point of having two.
    expect(resolveValueLimits(RESOLVED, BOUND).absoluteMax).toBe(20_000);
  });

  it('should fall back to the bounds block when the value omits its ceilings', () => {
    const limits = resolveValueLimits({ value: 500, source: 'default' }, BOUND);

    expect(limits.recommendedMax).toBe(2000);
    expect(limits.absoluteMax).toBe(20_000);
    expect(limits.complete).toBe(true);
  });

  it('should still produce a usable range when the API reported no ceilings at all', () => {
    const limits = resolveValueLimits({ value: 500, source: 'default' }, undefined);

    expect(Number.isFinite(limits.absoluteMax)).toBe(true);
    expect(limits.absoluteMax).toBeGreaterThan(500);
    expect(limits.min).toBeGreaterThan(0);
    expect(limits.complete).toBe(false);
  });

  it('should quote no recommendation reason it was not given', () => {
    const limits = resolveValueLimits({ value: 500, source: 'default' }, undefined);

    expect(limits.recommendedMax).toBeNull();
    expect(limits.recommendedReason).toBeNull();
  });

  it('should degrade when the whole value is missing rather than throwing', () => {
    expect(() => resolveValueLimits(undefined, undefined)).not.toThrow();
    expect(resolveValueLimits(undefined, undefined).complete).toBe(false);
  });

  it('should ignore a ceiling that is not a usable number', () => {
    const limits = resolveValueLimits(
      { value: 500, source: 'default', recommendedMax: 0, absoluteMax: Number.NaN },
      undefined,
    );

    expect(limits.recommendedMax).toBeNull();
    expect(limits.absoluteMax).toBeGreaterThan(500);
  });

  it('should keep a value already in force reachable on the slider', () => {
    // An env var can legitimately sit above every reported ceiling; a range
    // that could not reach it would snap the operator's setting downward on
    // first render.
    const limits = resolveValueLimits(
      { value: 50_000, source: 'env', recommendedMax: 2000, absoluteMax: 20_000 },
      BOUND,
    );

    expect(limits.absoluteMax).toBeGreaterThanOrEqual(50_000);
  });
});

describe('isAboveRecommended', () => {
  it('should report a value past the recommendation', () => {
    expect(isAboveRecommended(2001, resolveValueLimits(RESOLVED, BOUND))).toBe(true);
  });

  it('should not report a value at the recommendation', () => {
    expect(isAboveRecommended(2000, resolveValueLimits(RESOLVED, BOUND))).toBe(false);
  });

  it('should never treat an unknown recommendation as a crossed one', () => {
    // Otherwise a response that omitted the block would gate every save
    // behind an acknowledgement the page cannot explain.
    const limits = resolveValueLimits({ value: 500, source: 'default' }, undefined);

    expect(isAboveRecommended(19_000, limits)).toBe(false);
  });
});
