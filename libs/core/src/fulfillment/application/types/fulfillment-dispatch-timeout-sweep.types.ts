/**
 * Fulfilment Dispatch Timeout Sweep — I/O (#2712, ADR-054)
 *
 * The shapes `IFulfillmentDispatchTimeoutService` speaks. The pure rules live in
 * `domain/types/fulfillment-dispatch-timeout.types.ts`; this file is the
 * application-layer I/O beside them, the `fulfillment-handshake.types.ts` shape.
 *
 * @module libs/core/src/fulfillment/application/types
 */
import type { AuthorityAttentionOutcome } from '@openlinker/core/fulfillment-authority';

export interface ReapTimedOutDispatchesInput {
  /** Candidates examined per run. The caller clamps. */
  readonly limit: number;
  /**
   * The resolved deadline, passed IN rather than read here.
   *
   * `resolveFulfillmentDispatchTimeoutMs` is the single resolution path (AC3),
   * and it reads the environment — which a core service must not do per run.
   * The handler resolves it once and hands it over, so the number that selects
   * candidates and the number stamped on the rejection are the same value
   * rather than two reads that could disagree.
   */
  readonly timeoutMs: number;
  /**
   * The instant the run is reckoned from. Supplied by the caller so the rule is
   * testable without a fake clock — the `deriveOrderLifecyclePhase` /
   * `evaluateAutomationRules` discipline.
   */
  readonly now: Date;
}

/**
 * What the sweep wants written to `order_records.omsAttention`, REPORTED rather
 * than written.
 *
 * The `fulfillment` context is a registered zero-sibling-edge leaf and
 * `scripts/check-no-injection-contracts.mjs` forbids it from injecting an
 * `orders` service, so this is the #2400 report-don't-perform seam: the service
 * returns intents and the worker handler performs the write through
 * `IOrderRecordService.markOmsAttention`. The evidence the placement is right is
 * that this change adds ZERO entries to either guard's allow-set — needing one
 * would be the signal it is wrong.
 */
export interface FulfillmentAcceptanceAttentionIntent {
  readonly orderId: string;
  readonly outcome: AuthorityAttentionOutcome<'acceptance'>;
}

export interface ReapTimedOutDispatchesResult {
  /** Candidates the frontier returned. */
  readonly examined: number;
  /** Reaps that APPLIED — the guarded `submitted -> rejected` transition won. */
  readonly reaped: number;
  /**
   * The guard refused: a peer moved the row first — a late acceptance, a
   * concurrent sweep, or a re-request that bumped the attempt.
   *
   * An ordinary outcome, never an error (`FulfillmentWorkRepositoryPort`'s own
   * convention that `false` means "not applied"). **No attention intent is
   * emitted for a raced row**: if the holder accepted in that window, writing
   * A3-X would be a false claim about work somebody just took.
   */
  readonly raced: number;
  /** Rows with no `assignedConnectionId` — a rejection naming nobody excludes nobody. */
  readonly skippedUnassigned: number;
  /** Candidates whose write threw. Counted; the page continues. */
  readonly failed: number;
  /** The deadline this run applied — the same value the details quote. */
  readonly timeoutMs: number;
  readonly attentionIntents: readonly FulfillmentAcceptanceAttentionIntent[];
}
