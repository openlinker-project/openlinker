/**
 * Operational Settings Types Spec
 *
 * Covers the pure resolution + bounds rules (#2651): the `row -> env ->
 * default` ladder, the provenance it reports, and the clamps on both ends.
 *
 * @module libs/core/src/operational-settings/__tests__
 */
import {
  OPERATIONAL_SETTING_BOUNDS,
  checkOperationalSettingBound,
  clampToAdapterPageSize,
  readOperationalSettingEnv,
  resolveOperationalSetting,
} from '../domain/types/operational-settings.types';

describe('resolveOperationalSetting', () => {
  const ladder = (
    resolved: ReturnType<typeof resolveOperationalSetting>
  ): { value: number; source: string } => ({ value: resolved.value, source: resolved.source });

  it('should report the code default when neither a row nor an env var supplies a value', () => {
    expect(ladder(resolveOperationalSetting('catalogueSweepBudget', null, undefined))).toEqual({
      value: 500,
      source: 'default',
    });
  });

  it('should report the env rung when no row exists but the env var is set', () => {
    expect(ladder(resolveOperationalSetting('inventorySweepBudget', null, '250'))).toEqual({
      value: 250,
      source: 'env',
    });
  });

  it('should prefer the stored row over the env var', () => {
    expect(ladder(resolveOperationalSetting('inventorySweepBudget', 750, '250'))).toEqual({
      value: 750,
      source: 'setting',
    });
  });

  it('should ignore a malformed env var rather than clamping it, falling through to the default', () => {
    // The env rung is pre-#2651 behaviour that must not change: every read site
    // already ignored a non-numeric value.
    expect(ladder(resolveOperationalSetting('sweepPageSize', null, 'not-a-number'))).toEqual({
      value: 100,
      source: 'default',
    });
    expect(ladder(resolveOperationalSetting('sweepPageSize', null, '0'))).toEqual({
      value: 100,
      source: 'default',
    });
    expect(ladder(resolveOperationalSetting('sweepPageSize', null, '   '))).toEqual({
      value: 100,
      source: 'default',
    });
  });

  it('should clamp a stored value to the ABSOLUTE ceiling, so a hand-edited row cannot hand the worker an impossible budget', () => {
    expect(ladder(resolveOperationalSetting('catalogueSweepBudget', 99_999, undefined))).toEqual({
      value: OPERATIONAL_SETTING_BOUNDS.catalogueSweepBudget.absoluteMax,
      source: 'setting',
    });
    expect(ladder(resolveOperationalSetting('catalogueSweepBudget', -5, undefined))).toEqual({
      value: OPERATIONAL_SETTING_BOUNDS.catalogueSweepBudget.min,
      source: 'setting',
    });
  });

  // The governing rule: reported === enforced. Clamping an acknowledged value
  // back to the recommendation would show 5000 on the settings page and run
  // 2000 in the sweep.
  it('should NOT clamp a stored value back to the recommended ceiling', () => {
    const resolved = resolveOperationalSetting('catalogueSweepBudget', 5000, undefined);

    expect(resolved.value).toBe(5000);
    expect(resolved.aboveRecommended).toBe(true);
  });

  it('should report a value at or below the recommendation as not-above', () => {
    expect(resolveOperationalSetting('catalogueSweepBudget', 2000, undefined).aboveRecommended).toBe(
      false
    );
  });

  it('should carry both ceilings and their reasons so a UI renders the why', () => {
    const resolved = resolveOperationalSetting('sweepPageSize', null, undefined);

    expect(resolved.recommendedMax).toBe(100);
    expect(resolved.absoluteMax).toBe(500);
    expect(resolved.recommendedReason.length).toBeGreaterThan(0);
    expect(resolved.absoluteReason).toContain('query string');
  });

  it('should clamp an out-of-range env value to the absolute ceiling rather than passing it through', () => {
    expect(readOperationalSettingEnv('sweepPageSize', '5000')).toBe(
      OPERATIONAL_SETTING_BOUNDS.sweepPageSize.absoluteMax
    );
  });

  it('should let an env var exceed the recommendation — writing one is deliberate', () => {
    expect(readOperationalSettingEnv('sweepPageSize', '250')).toBe(250);
  });
});

describe('clampToAdapterPageSize', () => {
  it('should pass a value the adapter can send through untouched', () => {
    expect(clampToAdapterPageSize(100, 100)).toEqual({ value: 100, clamped: false });
  });

  // The clamp must be OBSERVABLE. A silent narrowing is the exact
  // reported-versus-enforced defect the ceiling split exists to prevent.
  it('should report that it clamped, so the caller can log it', () => {
    expect(clampToAdapterPageSize(250, 100)).toEqual({ value: 100, clamped: true });
  });
});

describe('checkOperationalSettingBound', () => {
  it('should accept a value at or below the recommendation with no acknowledgement', () => {
    expect(checkOperationalSettingBound('catalogueSweepBudget', 1)).toBeNull();
    expect(checkOperationalSettingBound('catalogueSweepBudget', 2000)).toBeNull();
  });

  it('should refuse a value above the recommendation without an acknowledgement, naming the ceiling and the reason', () => {
    const problem = checkOperationalSettingBound('catalogueSweepBudget', 2001);

    expect(problem).toContain('recommended maximum of 2000');
    expect(problem).toContain('acknowledgeAboveRecommended');
    // The reason travels with the refusal — "2001 is too high" with no
    // explanation is a message an operator works around rather than understands.
    expect(problem).toContain('1200 s window');
  });

  it('should accept a value above the recommendation once acknowledged', () => {
    expect(checkOperationalSettingBound('catalogueSweepBudget', 5000, true)).toBeNull();
    expect(checkOperationalSettingBound('sweepPageSize', 250, true)).toBeNull();
  });

  it('should refuse a value above the ABSOLUTE ceiling however loudly it is acknowledged', () => {
    const problem = checkOperationalSettingBound('sweepPageSize', 2000, true);

    expect(problem).toContain('must not exceed 500');
    expect(problem).toContain('query string');
  });

  it('should still refuse a value below the minimum', () => {
    expect(checkOperationalSettingBound('sweepPageSize', 0, true)).toBe(
      'sweepPageSize must be an integer of at least 1'
    );
  });

  it('should reject a non-integer', () => {
    expect(checkOperationalSettingBound('inventorySweepBudget', 12.5)).not.toBeNull();
  });
});
