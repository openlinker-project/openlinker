/**
 * Fulfillment Progress Claim Repository Port (#2400)
 *
 * The at-most-once gate for progress ingestion: one row per
 * `(workId, idempotencyKey)`, inserted before anything is written.
 *
 * ## Why the uniqueness is UNCONDITIONAL
 *
 * A partial index over "live" states was considered, on the
 * `reservations WHERE status = 'held'` / `order_changes WHERE status IN (...)`
 * precedent. It is the wrong shape here, and the difference is worth stating
 * because the precedents look superficially applicable.
 *
 * Those predicates are partial because they express **slot-holding**: a
 * terminal row must not block a legitimate fresh holder of the same slot, so
 * the index deliberately forgets terminal rows.
 *
 * A progress dedup key is the opposite — it is **permanent memory**. A replay
 * of the same key must be a no-op *forever*. Any predicate that lets a row fall
 * out of the index opens a window in which a replay re-moves counters and
 * re-fires a relay. So the predicate is exactly as wide as it needs to be only
 * when it is the whole table.
 *
 * ## `claim` answers a boolean, and a duplicate is the NORMAL path
 *
 * Not a named domain error, unlike this context's `FulfillmentHoldNotFoundError`
 * family: a replay is expected steady-state traffic, and modelling the expected
 * case as an exception forces the caller into catch-as-control-flow. The
 * `AutomationTriggerFiringRepository.claim` (#2360) idiom this copies answers
 * the same question the same way.
 *
 * @module libs/core/src/fulfillment/domain/ports
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */

export interface FulfillmentProgressClaimInput {
  readonly workId: string;
  readonly idempotencyKey: string;
  readonly connectionId: string;
  /** The reported event kind, for forensics. Never read as state. */
  readonly eventKind: string;
  readonly claimedAt: Date;
}

export interface FulfillmentProgressClaimRepositoryPort {
  /**
   * Insert the claim.
   *
   * @returns `true` if this caller won and may proceed; `false` if the key was
   * already claimed, in which case NOTHING was written.
   *
   * Enforcement is the composite primary key, never an application
   * `SELECT`-then-`INSERT`: under READ COMMITTED a plain `SELECT` takes no
   * locks and the conflicting row is a phantom that cannot be locked before it
   * exists. #2392 hit exactly this on its hold cap and had to lock the parent
   * row instead.
   */
  claim(input: FulfillmentProgressClaimInput): Promise<boolean>;
}
