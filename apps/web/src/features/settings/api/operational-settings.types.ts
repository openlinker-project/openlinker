/**
 * Operational Settings — API Types
 *
 * Wire shape of `GET`/`PUT /operational-settings` (#2651). Hand-mirrored
 * rather than imported: `apps/web` must not depend on `@openlinker/core`
 * (#591), so the browser carries its own copy of the contract.
 *
 * The one field that matters most here is `source`. Every value travels with
 * the rung that produced it, so the form renders `500 (default)` from what
 * the server said instead of comparing against a hardcoded 500 — a
 * client-side comparison is a second copy of the default, and it is wrong the
 * day the default moves.
 *
 * @module apps/web/src/features/settings/api
 */

export const OPERATIONAL_SETTING_SOURCES = ['setting', 'env', 'default'] as const;

export type OperationalSettingSource = (typeof OPERATIONAL_SETTING_SOURCES)[number];

/** The numeric knobs the endpoint owns. Mirrors `OPERATIONAL_SETTING_KEYS`. */
export const OPERATIONAL_SETTING_KEYS = [
  'catalogueSweepBudget',
  'inventorySweepBudget',
  'sweepPageSize',
  'deletionAuditBudget',
] as const;

export type OperationalSettingKey = (typeof OPERATIONAL_SETTING_KEYS)[number];

/** Every editable field, including the non-numeric cadence. */
export type OperationalSettingField = OperationalSettingKey | 'deletionAuditCadence';

export interface ResolvedNumberSetting {
  value: number;
  source: OperationalSettingSource;
}

export interface ResolvedCadenceSetting {
  value: string;
  source: OperationalSettingSource;
}

/**
 * The accepted range for one knob, as the server reports it.
 *
 * The form derives its `min`/`max` from this rather than restating them,
 * which is what keeps "what the API accepts" and "what the control allows"
 * one fact.
 */
export interface OperationalSettingBound {
  min: number;
  max: number;
  default: number;
  envVar: string;
}

export interface OperationalSettingsView {
  catalogueSweepBudget: ResolvedNumberSetting;
  inventorySweepBudget: ResolvedNumberSetting;
  sweepPageSize: ResolvedNumberSetting;
  deletionAuditBudget: ResolvedNumberSetting;
  deletionAuditCadence: ResolvedCadenceSetting;
  /**
   * Always `true`. The deletion audit is the deletion authority and has no
   * off switch on this surface; the page states that rather than leaving its
   * absence to be read as an oversight.
   */
  deletionAuditAlwaysEnabled: boolean;
  cadenceAppliesAt: string;
  updatedAt: string | null;
  updatedBy: string | null;
  bounds: Partial<Record<OperationalSettingKey, OperationalSettingBound>>;
}

/**
 * A partial write. An omitted field is left alone; an explicit `null` clears
 * it back to the env-or-default rung.
 */
export interface UpdateOperationalSettingsInput {
  catalogueSweepBudget?: number | null;
  inventorySweepBudget?: number | null;
  sweepPageSize?: number | null;
  deletionAuditBudget?: number | null;
  deletionAuditCadence?: string | null;
}
