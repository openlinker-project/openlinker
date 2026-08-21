/**
 * Resolve Concurrency Types
 *
 * Neutral description of how many marketplace calls a destination's category
 * resolve path keeps in flight at once (#2229).
 *
 * This exists because the ceiling is real, operator-affecting and — until now —
 * invisible. The streamed EAN resolve path (#2215, epic #2205) paces its
 * outbound calls below the shared outbound rate limiter, inside the adapter's
 * own resolver, so a connection with no `config.rateLimit` and no manifest
 * `defaultRateLimit` reads as "not rate-limited" on the connection page while a
 * fixed ceiling is in fact applied. A number an operator cannot see is one they
 * cannot reason about when a resolve run is slower than they expected.
 *
 * The type carries `adapterDefault` alongside the effective `maxInFlight` so a
 * clamped value can name what it clamped — "4, from your rate limit" is
 * actionable in a way that a bare "4" is not.
 *
 * @module domain/types
 * @see {@link EanCategoryMatcherStreaming} for the capability that declares it
 */

/**
 * Where the effective ceiling came from. `connection-config` means the
 * operator's own `Connection.config.rateLimit.maxConcurrent` bound it below the
 * adapter's default; `adapter-default` means the adapter's own number applies.
 */
export const ResolveConcurrencySourceValues = ['connection-config', 'adapter-default'] as const;
export type ResolveConcurrencySource = (typeof ResolveConcurrencySourceValues)[number];

export interface ResolveConcurrencyCeiling {
  /** Effective cap on simultaneous in-flight marketplace calls for one resolve run. */
  maxInFlight: number;
  source: ResolveConcurrencySource;
  /**
   * What the adapter would use with no operator cap configured. Equal to
   * `maxInFlight` when `source` is `'adapter-default'`.
   */
  adapterDefault: number;
}
