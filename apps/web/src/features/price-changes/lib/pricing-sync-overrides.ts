/**
 * Pricing Sync override helpers (#3729)
 *
 * The API reports a per-source override as two independent booleans
 * (`modeOverridden`, `ruleOverridden`). These helpers are the one place the
 * web side turns them into "has an override" / a human label, so no component
 * reads a flag the API does not send. Labels read the `price-changes`
 * namespace at call time.
 *
 * @module apps/web/src/features/price-changes/lib
 */
import { getMessages } from '../../../shared/i18n';

export interface OverrideFlags {
  modeOverridden: boolean;
  ruleOverridden: boolean;
}

export function hasOwnOverride(flags: OverrideFlags): boolean {
  return flags.modeOverridden || flags.ruleOverridden;
}

export type OverrideAxis = 'mode' | 'rule';

/** Label for ONE overridden axis; `describeOverride` composes it. */
export function describeOverrideAxis(axis: OverrideAxis): string {
  const copy = getMessages('price-changes').pricingSyncOverrides;
  return axis === 'mode' ? copy.mode : copy.rule;
}

/** Names WHAT is overridden; only meaningful when `hasOwnOverride` is true. */
export function describeOverride(flags: OverrideFlags): string {
  if (flags.modeOverridden && flags.ruleOverridden) {
    return getMessages('price-changes').pricingSyncOverrides.both;
  }
  if (flags.modeOverridden) return describeOverrideAxis('mode');
  if (flags.ruleOverridden) return describeOverrideAxis('rule');
  return '';
}
