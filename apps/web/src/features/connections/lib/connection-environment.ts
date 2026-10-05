/**
 * Connection environment reader (#2227, moved here for #3670)
 *
 * Several platforms (Allegro, Erli, inFakt, InPost, DPD, e-paragony) persist a
 * neutral `config.environment` of `sandbox | production`. It lives with the
 * connections feature because both the bulk wizard's destination bar and the
 * connection chip need it, and a sandbox connection must stay distinguishable
 * from its production twin wherever either is named.
 *
 * @module features/connections/lib
 */

export type ConnectionEnvironment = 'sandbox' | 'production';

/**
 * `Connection.config` is an untyped `Record<string, unknown>`, so the
 * environment is narrowed rather than cast - and an absent or unrecognised
 * value returns `null` so a surface can omit it instead of guessing an
 * environment the operator would act on.
 */
export function readConnectionEnvironment(
  config: Record<string, unknown> | undefined,
): ConnectionEnvironment | null {
  const value = config?.environment;
  return value === 'sandbox' || value === 'production' ? value : null;
}
