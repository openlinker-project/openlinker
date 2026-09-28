/**
 * Connection config merge (#3457)
 *
 * `PATCH /connections/:id` REPLACES `config` wholesale, so every wizard write
 * sends the freshly-read config back with exactly one key changed. Writing a
 * partial object would silently delete every other key on the connection:
 * its base URL, its rate limit, its stock buffer.
 *
 * Also owns the two key readers the wizard needs, so the rule for what a
 * stored value means lives in one place.
 *
 * @module features/oms-onboarding/lib
 */

export const STOCK_LOCATION_OVERRIDE_KEY = 'stockLocationOverride';
export const SOURCING_CLAIM_KEY = 'sourcingAuthority';

/** A new config with `key` set to `value`; every other key is untouched. */
export function withConfigKey(
  config: Record<string, unknown> | null | undefined,
  key: string,
  value: unknown
): Record<string, unknown> {
  return { ...(config ?? {}), [key]: value };
}

/** The connection's stock-location override, or `null` when unset. */
export function readStockLocationOverride(config: Record<string, unknown> | null | undefined): string | null {
  const value = config?.[STOCK_LOCATION_OVERRIDE_KEY];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * The sourcing claim as a writable object, preserving whatever else it
 * carries (`isPrimary`, `scopes`). The backend accepts `true`, `'true'` or an
 * object; the wizard always writes the object form so a stop keeps the
 * operator's scopes for the restart.
 */
export function withSourcingClaimEnabled(
  config: Record<string, unknown> | null | undefined,
  enabled: boolean
): Record<string, unknown> {
  const existing = config?.[SOURCING_CLAIM_KEY];
  const base =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return withConfigKey(config, SOURCING_CLAIM_KEY, { ...base, enabled });
}

/**
 * Display-only reading of the sourcing claim, for when the server's own
 * who-decides answer is unavailable. `'unset'` (no key at all) and `'off'`
 * (the key exists, switched off by a stop) are kept apart: the first means
 * packing was never set up, the second that it was and is paused.
 */
export function readSourcingClaim(
  config: Record<string, unknown> | null | undefined
): 'unset' | 'on' | 'off' {
  if (config === null || config === undefined || !(SOURCING_CLAIM_KEY in config)) return 'unset';
  const value = config[SOURCING_CLAIM_KEY];
  if (value === true || value === 'true') return 'on';
  if (typeof value === 'object' && value !== null && (value as { enabled?: unknown }).enabled === true) {
    return 'on';
  }
  return 'off';
}
