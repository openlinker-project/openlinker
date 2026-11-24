/**
 * Operational settings error routing tests (#3866)
 *
 * A domain refusal that names its rule and limit reads as that rule, with the
 * setting's own reason, next to the control it is about.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { mapOperationalSettingsErrors } from './map-operational-settings-errors';

function refusal(params: Record<string, unknown>): ApiError {
  return new ApiError('refused', 400, {
    code: 'OPERATIONAL_SETTING_INVALID',
    message: 'catalogueSweepBudget above the recommended maximum of 2000 requires acknowledgeAboveRecommended: true.',
    params,
  });
}

describe('mapOperationalSettingsErrors', () => {
  it('should phrase a recommended-ceiling refusal with its limit and the setting\'s reason', () => {
    const errors = mapOperationalSettingsErrors(
      refusal({ field: 'catalogueSweepBudget', rule: 'recommended', limit: 2000 }),
    );

    expect(errors.fieldErrors.catalogueSweepBudget).toMatch(
      /^This is above the recommended 2000\. Confirm it to save\. At 2000 products/,
    );
    expect(errors.formErrors).toEqual([]);
  });

  it('should phrase a minimum refusal without a reason', () => {
    const errors = mapOperationalSettingsErrors(
      refusal({ field: 'syncJobRetentionDays', rule: 'min', limit: 30 }),
    );

    expect(errors.fieldErrors.syncJobRetentionDays).toBe('Enter a whole number of at least 30.');
  });

  it('should phrase a cadence refusal', () => {
    const errors = mapOperationalSettingsErrors(
      refusal({ field: 'deletionAuditCadence', rule: 'cadence-too-rare' }),
    );

    expect(errors.fieldErrors.deletionAuditCadence).toBe(
      'The deletion check must run at least once every 7 days.',
    );
  });

  it('should fall back to the shared copy when the rule is not one it knows', () => {
    const errors = mapOperationalSettingsErrors(refusal({ field: 'sweepPageSize', rule: 'on-fire' }));

    expect(errors.fieldErrors.sweepPageSize).toBe('One of the values is outside the allowed range.');
  });
});
