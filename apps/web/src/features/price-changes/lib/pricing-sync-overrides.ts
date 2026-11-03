/**
 * Pricing Sync override helpers (#3729)
 *
 * The API reports a per-source override as two independent booleans
 * (`modeOverridden`, `ruleOverridden`). These helpers are the one place the
 * web side turns them into "has an override" / a human label, so no component
 * reads a flag the API does not send.
 *
 * @module apps/web/src/features/price-changes/lib
 */
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
  return axis === 'mode' ? 'own mode' : 'own rule';
}

/** Names WHAT is overridden; only meaningful when `hasOwnOverride` is true. */
export function describeOverride(flags: OverrideFlags): string {
  const axes: OverrideAxis[] = [];
  if (flags.modeOverridden) axes.push('mode');
  if (flags.ruleOverridden) axes.push('rule');
  if (axes.length === 2) return 'own mode and rule';
  return axes.map(describeOverrideAxis).join('');
}
