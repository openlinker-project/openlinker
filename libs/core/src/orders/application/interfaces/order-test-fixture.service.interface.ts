/**
 * Order Test Fixture Service Interface (#2855)
 *
 * A narrow seam of writes that exist ONLY to let a non-production install
 * reach analytics states no real ingestion flow can ever produce (e.g.
 * `taxRateEra = 'pre-rollout'`, written exactly once, by a historical
 * backfill migration). Never called against real order data — see
 * {@link IOrderTestFixtureService.markPreRolloutEraForTesting} for the double
 * gate (`@Roles('admin')` on the HTTP layer + `OL_ALLOW_TEST_FIXTURES` here).
 *
 * @module libs/core/src/orders/application/interfaces
 * @see {@link OrderTestFixtureService} for the implementation
 */
export interface IOrderTestFixtureService {
  /**
   * Stamps `taxRateEra = 'pre-rollout'` on one order so the `tax-a` / `tax-c`
   * analytics coverage states (#2482) become reachable with a fresh,
   * flow-seeded order in a non-production install.
   *
   * Refuses (throws `TestFixturesDisabledException`) unless
   * `OL_ALLOW_TEST_FIXTURES=true` is set in the process env — the env var
   * defaults OFF and must never be set in a production `.env`. This is the
   * SECOND gate alongside the HTTP layer's `@Roles('admin')`: role alone would
   * let a real production admin silently corrupt a real order's Net Sales
   * eligibility by mistake.
   *
   * Returns `true` if the row was changed by this call, `false` if it already
   * carried `'pre-rollout'` (idempotent — a repeated call is a no-op).
   */
  markPreRolloutEraForTesting(internalOrderId: string): Promise<boolean>;
}
