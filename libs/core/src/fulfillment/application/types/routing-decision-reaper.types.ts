/**
 * Routing Decision Reaper — I/O shapes (#2731)
 *
 * What one reaper pass takes and reports, and the read-only status view of an
 * order's latest routing decision.
 *
 * @module libs/core/src/fulfillment/application/types
 */
import type { AuthorityAttentionOutcome } from '@openlinker/core/fulfillment-authority';

import type { FulfillmentBlock } from '../../domain/types/fulfillment-block-reason.types';
import type {
  RoutingDecisionAbandonReason,
  RoutingDecisionState,
} from '../../domain/types/routing-decision.types';

/** The `routing-failed` detail when the re-route could not be enqueued. Stable across reaps. */
export const ROUTING_DECISION_REAP_FALLBACK_DETAIL = 'stranded-past-ttl';

export interface ReapStrandedDecisionsInput {
  readonly limit: number;
  /** Resolved once per run by the caller through `resolveRoutingDecisionTtlMs`. */
  readonly ttlMs: number;
  readonly now: Date;
}

/**
 * What the worker must do for ONE reaped decision.
 *
 * This leaf may not inject an `orders` service (ADR-053), so the reaper REPORTS
 * and the worker writes and enqueues — the #2712 split.
 */
export interface RoutingDecisionReapIntent {
  readonly orderId: string;
  readonly decisionId: string;
  /** The router the stranded decision was waiting on; the re-route runs under it. */
  readonly routerConnectionId: string;
  /** The `routing` producer entry to record before the re-route (`routing-stuck`). */
  readonly attention: AuthorityAttentionOutcome<'routing'>;
  /**
   * The block to write ONLY when the re-route could not be enqueued, so
   * `fulfillment.work.rerouteSweep` picks the order up instead. Written
   * unconditionally it would race the re-route, which writes the order's real
   * hold state itself.
   */
  readonly fallbackBlock: FulfillmentBlock;
}

export interface ReapStrandedDecisionsResult {
  readonly examined: number;
  readonly reaped: number;
  /** A peer (a late commit or refusal, or another reaper) terminalised it first. */
  readonly raced: number;
  readonly failed: number;
  readonly ttlMs: number;
  readonly intents: readonly RoutingDecisionReapIntent[];
}

/**
 * The read-only view of an order's latest routing decision.
 *
 * `strandedSince` is set only for a `live` decision already past its TTL, i.e.
 * one the next reaper tick will close. There is deliberately no action field:
 * the operator cannot force, check or abandon a decision (D4).
 */
export interface RoutingDecisionStatusView {
  readonly decisionId: string;
  readonly state: RoutingDecisionState;
  readonly routerConnectionId: string;
  readonly createdAt: Date;
  readonly ageMs: number;
  readonly ttlMs: number;
  readonly strandedSince: Date | null;
  readonly abandonReason: RoutingDecisionAbandonReason | null;
  readonly terminalisedAt: Date | null;
}

export interface GetRoutingDecisionStatusInput {
  readonly orderId: string;
  readonly ttlMs: number;
  readonly now: Date;
}
