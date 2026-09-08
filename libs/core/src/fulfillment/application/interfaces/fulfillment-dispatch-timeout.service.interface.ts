/**
 * Fulfilment Dispatch Timeout Service — contract (#2712, ADR-054)
 *
 * ADR-054's **timeout-as-rejection sweep**: a `FulfillmentWork` in `submitted`
 * whose holder never answers reaches a re-routable state instead of sitting
 * there for ever.
 *
 * ## What #2399 got right, and what this must preserve
 *
 * The pre-#2712 behaviour is **safe, not merely absent** — a stalled work is
 * never silently retried, because the resume path is attempt-scoped and
 * terminal-safe. Converting a timeout into a rejection FREES the work to be
 * re-routed, so this pass is precisely the moment a double-ship becomes
 * possible. Two properties keep it closed:
 *
 *  - the reap goes through the UNCHANGED
 *    `FulfillmentWorkRepositoryPort.recordRejection`, whose guard is
 *    `requestStatus = 'submitted'`, so a late acceptance and a reap race on ONE
 *    row and exactly one wins; and
 *  - the reap additionally pins `expectedAssignmentAttempt`, so a row that left
 *    and re-entered `submitted` in the read-then-write window is not rejected
 *    under an attempt that is no longer live.
 *
 * ## It does not re-route, and it does not clear the holder
 *
 * `rejected` IS the re-routable state — `FulfillmentHandshakeService`'s
 * `CLAIMABLE_FROM` already contains it — so a future re-source (#2395) picks
 * these up with no change here. And the handshake does NOT `clearHolder` on a
 * rejection, so neither does this: a sweep that did would leave a different
 * state for the same outcome, and re-assignment is #2395's.
 *
 * @module libs/core/src/fulfillment/application/interfaces
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */
import type { AuthorityAttentionOutcome } from '@openlinker/core/fulfillment-authority';

import type {
  ReapTimedOutDispatchesInput,
  ReapTimedOutDispatchesResult,
} from '../types/fulfillment-dispatch-timeout-sweep.types';

export interface IFulfillmentDispatchTimeoutService {
  /**
   * Examine one bounded page of idle `submitted` works and reap what is still
   * reapable.
   *
   * **Frontier-as-query, and never a scan offset.** The candidate set is
   * `requestStatus = 'submitted' AND updatedAt < cutoff`, and every page
   * CONSUMES its own selection — a reaped row moves to `rejected` and leaves the
   * set. An advancing offset over a shrinking set steps over rows, which here
   * means a work that is never reaped and an order that stalls for ever: the
   * exact defect this pass exists to fix. `bounded-sweep.ts` draws that
   * distinction in its own header, and #2317 / #2346 recorded the same reasoning
   * for the same shape. There is therefore no cursor at all — the predicate is
   * the cursor.
   *
   * Per-candidate failures are counted and the page continues; only an
   * infrastructure failure of the frontier read itself propagates.
   */
  reapTimedOutDispatches(
    input: ReapTimedOutDispatchesInput
  ): Promise<ReapTimedOutDispatchesResult>;

  /**
   * Re-answer "has this order got fulfilment work nobody took?" from ALL of its
   * work objects.
   *
   * **This is what makes A3-X level-triggered rather than sticky** (#2100's
   * rule). The sweep RAISES the state; a later accepted dispatch must clear it,
   * or an order carries a permanent red mark that no operator action can remove
   * — worse than no mark at all. The caller is the dispatch handler, after any
   * handshake outcome.
   *
   * It lives on THIS interface because this service owns
   * `deriveAcceptanceAttention`. A second caller re-deriving the verdict from
   * its own read is how the sweep's answer and the handshake's start disagreeing
   * about one order.
   *
   * Reading the whole order is what makes it SPLIT-SAFE: `omsAttention` is keyed
   * `(order, producer)`, so a per-work answer would let one parcel's acceptance
   * clear a stuck sibling's flag.
   *
   * It also covers a holder's OWN rejection, which is correct rather than
   * incidental — A3-X's descriptor reads *"every candidate rejected **or timed
   * out**"*, so both causes are the same operator-facing state.
   *
   * REPORTS the verdict; the caller writes it (ADR-053).
   */
  recomputeAcceptanceAttention(orderId: string): Promise<AuthorityAttentionOutcome<'acceptance'>>;
}
