/**
 * Order Test Fixture Service Interface (#2855)
 *
 * A narrow seam of writes that exist ONLY to let a non-production install
 * reach analytics states no real ingestion flow can ever produce (e.g.
 * `taxRateEra = 'pre-rollout'`, written exactly once, by a historical
 * backfill migration). Never called against real order data — see
 * {@link IOrderTestFixtureService.markPreRolloutEraForTesting} for the triple
 * gate (`@Roles('admin')` on the HTTP layer + `OL_ALLOW_TEST_FIXTURES` +
 * `NODE_ENV !== 'production'` here).
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
   * eligibility by mistake. A THIRD, fail-closed check refuses unconditionally
   * under `NODE_ENV=production` — the `credentials-resolver.service.ts` §709
   * precedent — so a deploy that accidentally carries the env var set is still
   * caught rather than trusting the var alone.
   *
   * `actorUserId` is recorded in the warn-level audit log line — never the
   * env var alone, and never omitted — matching `placeHold`/`releaseHold` in
   * the same controller: an endpoint whose own docblock says "MUST NEVER be
   * called against real order data" must record WHO invoked it.
   *
   * **Why a log line and not a ledger row, when #2468 needed one.** The
   * comparison is the obvious one to make and the answer is deliberate rather
   * than an oversight: #2468 justified the single exception to FX-stamp
   * immutability with a persisted `analytics_remediation_runs` row because
   * that write moves a financial figure of record, and a figure that moves
   * with no traceable cause is what ADR-040 forbids. This write moves the
   * same KIND of figure — a pre-rollout stamp silently drops the order out of
   * Net Sales — but it is structurally impossible where a figure of record
   * exists: the `NODE_ENV === 'production'` gate is unconditional and is
   * checked first, so there is no production install in which this row can be
   * written and therefore no audit trail for a production reader to need. The
   * log line exists for the developer standing in front of the seeded stand,
   * which is the only place it can run.
   *
   * Returns `true` if the row was changed by this call, `false` if it already
   * carried `'pre-rollout'` (idempotent — a repeated call is a no-op).
   */
  markPreRolloutEraForTesting(internalOrderId: string, actorUserId: string): Promise<boolean>;

  /**
   * The gate alone, with no side effect — lets a caller fail fast (and avoid
   * an unnecessary DB read) before it looks up anything else. Throws the same
   * `TestFixturesDisabledException` `markPreRolloutEraForTesting` would.
   */
  assertTestFixturesAllowed(): void;
}
