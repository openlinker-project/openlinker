/**
 * Routing hold outcome (#3485, epic #3460)
 *
 * What a routing commit outcome means for the ORDER: is it held in OpenLinker,
 * why, and does a line need an operator's refund/return decision.
 *
 * ## One rule, two routing sites
 *
 * Both hosts that call `IRoutingCommitService.route()` — the ingestion
 * intercept (#2396) and the `fulfillment.work.route` handler (#2395, re-driven
 * by `fulfillment.work.rerouteSweep`) — map the outcome through this function.
 * Two mappings would let one site hold an order the other mirrors, which is the
 * double shipment the #2408 "one body answers" rule exists to prevent.
 *
 * ## Why a refused plan is now a hold
 *
 * #2396 let `refused` fall back to the destination mirror. Once OpenLinker's
 * OMS is the router, that fallback created the order in EVERY product master
 * (epic #3460: with the OMS on, the order stays in OpenLinker). A refusal
 * terminalises the decision to `abandoned`, which frees the live-decision
 * index, so holding does not strand the order: a later `route()` mints a fresh
 * decision.
 *
 * ## The UF-L attention is REPORTED, never written here
 *
 * `lineAttention` is what the order's `routing` producer (`line-unfulfillable`,
 * spec row UF-L) should say. This context is a zero-sibling-edge leaf and may
 * not inject an `orders` service (ADR-053), so the caller writes it with
 * `IOrderRecordService.markOmsAttention(orderId, 'routing', …)`. Only a refusal
 * whose plan carried unfulfillable lines raises it: the other refusals are
 * router or commit failures, not "this line cannot ship from anywhere".
 *
 * ## Refusal details are STABLE across re-routes
 *
 * Every re-route mints a new decision id (`fulfillment.work.rerouteSweep`
 * re-drives a refused order every tick while it stays out of stock). Putting
 * that id in the block detail or the UF-L entry would change the stored value
 * on every tick, defeating the `IS DISTINCT FROM` guards and bumping
 * `order_records.updatedAt` — a live filter axis — for every held order, every
 * tick. The decision id is already on the `routing_decisions` row.
 *
 * Pure: no I/O, no clock, no mutation (the pure-rule exception in
 * `engineering-standards.md`).
 *
 * @module libs/core/src/fulfillment/application/types
 */
import type { AuthorityAttentionOutcome } from '@openlinker/core/fulfillment-authority';

import type { FulfillmentBlock } from '../../domain/types/fulfillment-block-reason.types';
import type { RoutingCommitOutcome } from './routing-commit.types';

export interface RoutingHoldOutcome {
  /** `true` means no destination mirror: the order stays in OpenLinker. */
  readonly held: boolean;
  /** Why a held order has no work object explaining it; `null` when none. */
  readonly block: FulfillmentBlock | null;
  /** The order's `routing` producer entry (UF-L), level-triggered. */
  readonly lineAttention: AuthorityAttentionOutcome<'routing'>;
}

const LINE_ATTENTION_CLEARED: AuthorityAttentionOutcome<'routing'> = { kind: 'none' };
const LINE_ATTENTION_UNTOUCHED: AuthorityAttentionOutcome<'routing'> = { kind: 'indeterminate' };

/**
 * Map a routing commit outcome onto the order's hold state.
 *
 * Exhaustive over `RoutingCommitOutcome['status']`: a new outcome is a compile
 * error here, and at runtime an unrecognised one THROWS rather than returning,
 * because a returned object with a falsy `held` would mirror an order the
 * router may already have committed.
 */
export function deriveRoutingHoldOutcome(outcome: RoutingCommitOutcome): RoutingHoldOutcome {
  switch (outcome.status) {
    case 'routed':
      // The work object IS the explanation (#2402), and a routed order has no
      // unfulfillable line — so a previous UF-L entry is cleared.
      return { held: true, block: null, lineAttention: LINE_ATTENTION_CLEARED };

    case 'in-doubt':
      // The router may already be picking: withhold the mirror, and say nothing
      // about the lines — OpenLinker does not know the plan yet.
      return {
        held: true,
        block: {
          reason: 'routing-in-doubt',
          detail: `decision ${outcome.decisionId} left live for resumption (${outcome.cause})`,
        },
        lineAttention: LINE_ATTENTION_UNTOUCHED,
      };

    case 'contended':
      // A peer holds the lock and owns the decision; its outcome writes the lines.
      return {
        held: true,
        block: { reason: 'routing-contended', detail: null },
        lineAttention: LINE_ATTENTION_UNTOUCHED,
      };

    case 'skipped':
      if (outcome.reason === 'order-cancelled') {
        // A cancelled order needs no hold and has no line decision left to make.
        return { held: false, block: null, lineAttention: LINE_ATTENTION_CLEARED };
      }
      // The #2047 guard: some route already owns this order.
      return {
        held: true,
        block: {
          reason: 'routing-already-live-elsewhere',
          detail: `routing refused: ${outcome.reason}`,
        },
        lineAttention: LINE_ATTENTION_UNTOUCHED,
      };

    case 'refused':
      return {
        held: true,
        block: { reason: 'routing-refused', detail: outcome.reason },
        lineAttention:
          outcome.reason === 'plan-carries-unfulfillable'
            ? { kind: 'blocked', reason: 'line-unfulfillable' }
            : LINE_ATTENTION_CLEARED,
      };

    default: {
      const unreachable: never = outcome;
      throw new Error(`Unrecognised routing commit outcome: ${JSON.stringify(unreachable)}`);
    }
  }
}
