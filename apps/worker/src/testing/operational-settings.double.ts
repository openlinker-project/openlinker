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
  type OperationalSettingsView,
} from '@openlinker/core/operational-settings';

export class FakeOperationalSettingsService implements IOperationalSettingsService {
  private view: OperationalSettingsView = {
    catalogueSweepBudget: {
      value: OPERATIONAL_SETTING_BOUNDS.catalogueSweepBudget.default,
      source: 'default',
    },
    inventorySweepBudget: {
      value: OPERATIONAL_SETTING_BOUNDS.inventorySweepBudget.default,
      source: 'default',
    },
    sweepPageSize: { value: OPERATIONAL_SETTING_BOUNDS.sweepPageSize.default, source: 'default' },
    deletionAuditBudget: {
      value: OPERATIONAL_SETTING_BOUNDS.deletionAuditBudget.default,
      source: 'default',
    },
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
