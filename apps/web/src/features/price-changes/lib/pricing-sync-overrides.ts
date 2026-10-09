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

/** Names WHAT is overridden; only meaningful when `hasOwnOverride` is true. */
export function describeOverride(flags: OverrideFlags): string {
  if (flags.modeOverridden && flags.ruleOverridden) return 'own mode and rule';
  if (flags.modeOverridden) return 'own mode';
  return 'own rule';
}
