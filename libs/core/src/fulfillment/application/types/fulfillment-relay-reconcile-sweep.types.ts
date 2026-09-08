/**
 * Dispatch-Relay Reconcile Sweep — the I/O shapes (#2728, ADR-054)
 *
 * The read half of the pass. The service that produces these REPORTS candidates
 * and performs no relay: firing one means importing `@openlinker/core/orders`,
 * which `scripts/check-no-injection-contracts.mjs` and `barrel-purity.spec.ts`
 * independently forbid under this directory — ADR-053's report-don't-perform
 * discipline, and the same seam `IFulfillmentProgressService.record` already uses
 * for this exact intent.
 *
 * @module libs/core/src/fulfillment/application/types
 */
import type { FulfillmentRelayIntent } from '../../domain/types/fulfillment-progress-event.types';

/** The `dispatch` arm, narrowed — this pass reports no other intent kind. */
export type FulfillmentDispatchRelayIntent = Extract<FulfillmentRelayIntent, { kind: 'dispatch' }>;

export interface ListUnrelayedDispatchesInput {
  /** Candidates examined this run. Clamped by the caller. */
  readonly limit: number;
  /** `resolveFulfillmentRelayGraceMs` — a work younger than this is left alone. */
  readonly graceMs: number;
  /** `resolveFulfillmentRelayStuckAfterMs` — past this a candidate ESCALATES. */
  readonly stuckAfterMs: number;
  /** The run's instant, supplied so the classification is testable. */
  readonly now: Date;
}

/**
 * One work to re-drive.
 *
 * Carries the INTENT rather than a bare id, so the caller hands
 * `IFulfillmentDispatchRelayService.relayDispatch` the shape #2400 already
 * defined instead of assembling a second spelling of one fact.
 */
export interface UnrelayedDispatchCandidate {
  readonly intent: FulfillmentDispatchRelayIntent;
  readonly orderId: string;
  /** OL's own instant for the earliest `shipped` progress claim on this work. */
  readonly shippedAt: Date;
  /**
   * Past the escalation age — `isFulfillmentRelayStuck`.
   *
   * **A stuck candidate is still returned and still re-driven.** #1947 classifies
   * `adapter-unresolved` as TRANSIENT precisely because it clears on a re-auth, so
   * withholding it would convert a recoverable condition into a permanent one. What
   * the flag changes is that the caller counts and escalates it, which is the whole
   * of decision 4.
   */
  readonly stuck: boolean;
}

export interface ListUnrelayedDispatchesResult {
  readonly candidates: readonly UnrelayedDispatchCandidate[];
  /** How many of `candidates` are past the escalation age. */
  readonly stuckCount: number;
  /** Echoed so what an operator reads and what classified the work cannot differ. */
  readonly stuckAfterMs: number;
  /** The operator-facing sentence for `stuckAfterMs`, built from that same number. */
  readonly stuckDetail: string;
}
