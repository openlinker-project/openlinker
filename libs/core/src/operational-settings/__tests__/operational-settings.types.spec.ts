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
  readOperationalSettingEnv,
  resolveOperationalSetting,
} from '../domain/types/operational-settings.types';

describe('resolveOperationalSetting', () => {
  it('should report the code default when neither a row nor an env var supplies a value', () => {
    const resolved = resolveOperationalSetting('catalogueSweepBudget', null, undefined);

    expect(resolved).toEqual({ value: 500, source: 'default' });
  });

  it('should report the env rung when no row exists but the env var is set', () => {
    const resolved = resolveOperationalSetting('inventorySweepBudget', null, '250');

    expect(resolved).toEqual({ value: 250, source: 'env' });
  });

  it('should prefer the stored row over the env var', () => {
    const resolved = resolveOperationalSetting('inventorySweepBudget', 750, '250');

    expect(resolved).toEqual({ value: 750, source: 'setting' });
  });

  it('should ignore a malformed env var rather than clamping it, falling through to the default', () => {
    // The env rung is pre-#2651 behaviour that must not change: every read site
    // already ignored a non-numeric value.
    expect(resolveOperationalSetting('sweepPageSize', null, 'not-a-number')).toEqual({
      value: 100,
      source: 'default',
    });
    expect(resolveOperationalSetting('sweepPageSize', null, '0')).toEqual({
      value: 100,
      source: 'default',
    });
    expect(resolveOperationalSetting('sweepPageSize', null, '   ')).toEqual({
      value: 100,
      source: 'default',
    });
  });

  it('should clamp a stored value that is out of range, so a hand-edited row cannot hand the worker an impossible budget', () => {
    expect(resolveOperationalSetting('catalogueSweepBudget', 99_999, undefined)).toEqual({
      value: OPERATIONAL_SETTING_BOUNDS.catalogueSweepBudget.max,
      source: 'setting',
    });
    expect(resolveOperationalSetting('catalogueSweepBudget', -5, undefined)).toEqual({
      value: OPERATIONAL_SETTING_BOUNDS.catalogueSweepBudget.min,
      source: 'setting',
    });
  });

  it('should clamp an out-of-range env value to the bound rather than passing it through', () => {
    expect(readOperationalSettingEnv('sweepPageSize', '5000')).toBe(
      OPERATIONAL_SETTING_BOUNDS.sweepPageSize.max
    );
  });
});

describe('checkOperationalSettingBound', () => {
  it('should accept a value inside the range', () => {
    expect(checkOperationalSettingBound('catalogueSweepBudget', 1)).toBeNull();
    expect(checkOperationalSettingBound('catalogueSweepBudget', 2000)).toBeNull();
  });

  it('should name the field and the accepted range when the value is out of range', () => {
    expect(checkOperationalSettingBound('catalogueSweepBudget', 2001)).toBe(
      'catalogueSweepBudget must be an integer between 1 and 2000'
    );
    expect(checkOperationalSettingBound('sweepPageSize', 0)).toBe(
      'sweepPageSize must be an integer between 1 and 100'
    );
  });

  it('should reject a non-integer', () => {
    expect(checkOperationalSettingBound('inventorySweepBudget', 12.5)).not.toBeNull();
  });
});
