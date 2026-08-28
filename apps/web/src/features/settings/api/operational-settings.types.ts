/**
 * Operational Settings — API Types
 *
 * Wire shape of `GET`/`PUT /operational-settings` (#2651). Hand-mirrored
 * rather than imported: `apps/web` must not depend on `@openlinker/core`
 * (#591), so the browser carries its own copy of the contract.
 *
 * Two fields carry most of the meaning here.
 *
 * `source` is the rung that produced the value, so the form renders
 * `500 (default)` from what the server said instead of comparing against a
 * hardcoded 500 — a client-side comparison is a second copy of the default,
 * and it is wrong the day the default moves.
 *
 * And there are TWO ceilings, which must not be conflated. `recommendedMax`
 * is OpenLinker's judgement and is advisory: an operator may exceed it by
 * saying so explicitly. `absoluteMax` is refused whatever anyone says. The
 * control's range therefore runs to `absoluteMax` — stopping it at the
 * recommendation would make the raised ceiling unreachable, which is the one
 * thing this shape exists to allow.
 *
 * Every field the ceilings added is OPTIONAL on the way in. An API that
 * predates them, or one that omits a block, must degrade to a working page
 * rather than a thrown render — see `lib/resolve-value-limits.ts`.
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

/**
 * A resolved number, plus which ceiling applies to it and why.
 *
 * The ceiling fields are optional so a response that omits them still renders
 * a usable control; `resolveValueLimits` supplies the fallback and reports
 * that it had to.
 */
export interface ResolvedNumberSetting {
  value: number;
  source: OperationalSettingSource;
  /** Our advisory ceiling. Exceedable with an explicit acknowledgement. */
  recommendedMax?: number;
  /** Why the recommendation sits where it does, in the API's own words. */
  recommendedReason?: string;
  /** The refusal line. No acknowledgement can exceed it. */
  absoluteMax?: number;
  absoluteReason?: string;
  /** True when the effective value already exceeds our recommendation. */
  aboveRecommended?: boolean;
}

export interface ResolvedCadenceSetting {
  value: string;
  source: OperationalSettingSource;
}

/**
 * The accepted range for one knob, as the server reports it in the `bounds`
 * block. Carries `min` and `default`, which the per-value shape does not.
 */
export interface OperationalSettingBound {
  min?: number;
  recommendedMax?: number;
  recommendedReason?: string;
  absoluteMax?: number;
  absoluteReason?: string;
  default?: number;
  envVar?: string;
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
  bounds?: Partial<Record<OperationalSettingKey, OperationalSettingBound>>;
  /**
   * A platform may narrow a page size further where its own API caps it. The
   * API says so in its own words; the page renders that sentence rather than
   * restating a cap it would then have to keep in step.
   */
  adapterClampNote?: string;
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
  /**
   * Permission to exceed a RECOMMENDED ceiling on this request.
   *
   * Per-request by contract, and set only from an operator's explicit
   * acknowledgement — never inferred from the value being high, which would
   * turn the gate into a formality.
   */
  acknowledgeAboveRecommended?: boolean;
}
