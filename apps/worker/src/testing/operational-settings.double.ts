/**
 * Operational Settings Test Double
 *
 * A mutable `IOperationalSettingsService` fake for worker specs (#2651). Kept
 * here rather than as a `@openlinker/core/operational-settings/testing`
 * sub-barrel: the port has two methods and no state worth modelling, and the
 * engineering standard reserves that sub-barrel for a mocking surface large or
 * stateful enough that hand-rolling it per spec is real friction.
 *
 * `setValue` exists so a spec can prove the PER-TICK read: change the value
 * between two `execute()` calls and assert the second run used the new one,
 * with no re-construction anywhere.
 *
 * @module apps/worker/src/testing
 */
import {
  DELETION_AUDIT_CADENCE_DEFAULT,
  OPERATIONAL_SETTING_BOUNDS,
  type IOperationalSettingsService,
  type OperationalSettingKey,
  type OperationalSettingsView,
  type ResolvedOperationalNumber,
} from '@openlinker/core/operational-settings';

/**
 * A resolved number sitting on its built-in default, with the ceilings the
 * real service reports alongside it.
 */
const defaultNumber = (key: OperationalSettingKey): ResolvedOperationalNumber => {
  const bound = OPERATIONAL_SETTING_BOUNDS[key];
  return {
    value: bound.default,
    source: 'default',
    recommendedMax: bound.recommendedMax,
    recommendedReason: bound.recommendedReason,
    absoluteMax: bound.absoluteMax,
    absoluteReason: bound.absoluteReason,
    aboveRecommended: false,
  };
};

/**
 * Builds a resolved number a spec is overriding, so a test does not have to
 * restate the ceiling fields it does not care about.
 */
export const settingNumber = (
  key: OperationalSettingKey,
  value: number
): ResolvedOperationalNumber => {
  const bound = OPERATIONAL_SETTING_BOUNDS[key];
  return {
    ...defaultNumber(key),
    value,
    source: 'setting',
    aboveRecommended: value > bound.recommendedMax,
  };
};

export class FakeOperationalSettingsService implements IOperationalSettingsService {
  private view: OperationalSettingsView = {
    catalogueSweepBudget: defaultNumber('catalogueSweepBudget'),
    inventorySweepBudget: defaultNumber('inventorySweepBudget'),
    sweepPageSize: defaultNumber('sweepPageSize'),
    deletionAuditBudget: defaultNumber('deletionAuditBudget'),
    deletionAuditCadence: { value: DELETION_AUDIT_CADENCE_DEFAULT, source: 'default' },
    deletionAuditAlwaysEnabled: true,
    updatedAt: null,
    updatedBy: null,
  };

  resolve(): Promise<OperationalSettingsView> {
    return Promise.resolve(this.view);
  }

  updateSettings(): Promise<void> {
    return Promise.resolve();
  }

  /** Overwrite part of the resolved view, as an operator write would. */
  setValues(patch: Partial<OperationalSettingsView>): void {
    this.view = { ...this.view, ...patch };
  }
}
