/**
 * Restock Outcome Classification (#2370, `W2-33`)
 *
 * The ONE place that reads what the inventory master said about a restock. Pure
 * — no I/O, no injected dependency, no clock, no argument mutation — following
 * the same shape as #2367's custody transitions and every other rule engine in
 * this tree (`applyPricingRule`, `checkRequiredToSell`, `resolveOfferLifecycle`).
 *
 * It exists as one function rather than an `if` in the service because every
 * rule below is a rule someone could plausibly get backwards, and each one
 * backwards is stock that silently did or did not move:
 *
 *  - **An ABSENT `adjustmentOutcome` reads as `idempotency: 'unsupported'`**
 *    (#2368), never as a honoured dedupe. Reading silence as "already applied"
 *    would let a retry skip a restock that never ran.
 *  - **`disposition: 'deduplicated'` is a SUCCESS.** The units are already in
 *    the master's book; a caller must not count them twice.
 *  - **`appliedAt` is never consulted.** It is always `null` on PrestaShop
 *    (#2369 — `stock_availables` has no timestamp column), so treating it as
 *    evidence of success would classify every PrestaShop restock as a failure.
 *    `disposition` is the discriminator.
 *  - **Any throw is a block.** The classifier catches `unknown`, not a platform
 *    exception type: core cannot name `PrestashopNotSupportedException` and must
 *    not try, and #2369's cache-outage path fails closed through the same door.
 *    A double restock is unrecoverable; a block is recoverable by attestation.
 *
 * @module domain/domain-services
 * @see libs/core/src/inventory/domain/ports/inventory-master.port.ts
 */
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type { InventoryAdjustmentResult } from '@openlinker/core/inventory';

import type {
  ReturnRestockBlockReason,
  ReturnRestockState,
  RestockedBy,
} from '../types/return-line-event.types';

/**
 * What the classifier decided, in the vocabulary the act row persists.
 *
 * `countsTowardRestocked` is reported rather than re-derived by the caller
 * because it is the single most consequential bit in this slice: it decides
 * whether `quantityRestocked` moves, and spec § 5.4 requires that blocked units
 * stay in `quantityReceived`. Deriving it at the call site is how the rule and
 * the counter start disagreeing.
 */
export interface RestockOutcome {
  restockState: ReturnRestockState;
  restockBlockedReason: ReturnRestockBlockReason | null;
  restockBlockedDetail: string | null;
  restockedBy: RestockedBy | null;
  /** True only for `applied` / `deduplicated` — the master's book holds them. */
  countsTowardRestocked: boolean;
  /**
   * True when the adapter admitted it cannot dedupe (#2368). Not a failure —
   * the write landed — but the caller logs it, because a retry against such a
   * master WILL double-apply and only the adapter's admission reveals that.
   */
  idempotencyUnsupported: boolean;
}

/**
 * Classify a successful `adjustInventory` return value.
 */
export function classifyRestockSuccess(result: InventoryAdjustmentResult): RestockOutcome {
  // Absent means "not reported" — a pre-#2368 adapter — and the contract says a
  // caller MUST read that exactly as `unsupported`.
  const outcome = result.adjustmentOutcome;
  const idempotency = outcome?.idempotency ?? 'unsupported';

  // `deduplicated` and `applied` are both successes; anything else would be a
  // value this build does not know, and guessing at it would report stock as
  // moved on the strength of a word we did not understand.
  const disposition = outcome?.disposition;
  if (disposition !== undefined && disposition !== 'applied' && disposition !== 'deduplicated') {
    return {
      restockState: 'blocked',
      restockBlockedReason: 'unknown',
      restockBlockedDetail: `the inventory master reported an unrecognised disposition "${String(
        disposition
      )}"`,
      restockedBy: null,
      countsTowardRestocked: false,
      idempotencyUnsupported: idempotency === 'unsupported',
    };
  }

  return {
    restockState: disposition === 'deduplicated' ? 'deduplicated' : 'applied',
    restockBlockedReason: null,
    restockBlockedDetail: null,
    restockedBy: 'inventory_master',
    countsTowardRestocked: true,
    idempotencyUnsupported: idempotency === 'unsupported',
  };
}

/**
 * Classify a throw from `adjustInventory` — or from resolving the adapter that
 * would have served it.
 *
 * @param reason the caller's structural knowledge, where it has any. A failure
 *   to resolve a connection is not the master refusing; the caller knows which
 *   it was and the classifier does not, so it is passed in rather than sniffed.
 */
export function classifyRestockFailure(
  error: unknown,
  reason: ReturnRestockBlockReason = 'master-refused'
): RestockOutcome {
  // #1688's neutral error, widened to the write path by #2369: the platform
  // itself reports the product absent. Distinguished from a generic refusal
  // because the operator's remedy differs — there is nothing to restock INTO.
  const resolvedReason: ReturnRestockBlockReason =
    error instanceof MasterProductNotFoundError ? 'master-product-not-found' : reason;

  return {
    restockState: 'blocked',
    restockBlockedReason: resolvedReason,
    // The adapter's own sentence, verbatim. #2369 raises four distinct typed
    // refusals that are four different operator actions; the closed reason above
    // can only ever say "it refused", so the detail is what an operator quotes.
    restockBlockedDetail: extractMessage(error),
    restockedBy: null,
    countsTowardRestocked: false,
    idempotencyUnsupported: false,
  };
}

/**
 * A block OL decided on its own, before any adapter was reached — no master
 * resolved, or several did. Kept beside the two above so every value the
 * `restockState` column can hold is minted in one file.
 */
export function blockedBeforeMaster(
  reason: ReturnRestockBlockReason,
  detail: string
): RestockOutcome {
  return {
    restockState: 'blocked',
    restockBlockedReason: reason,
    restockBlockedDetail: detail,
    restockedBy: null,
    countsTowardRestocked: false,
    idempotencyUnsupported: false,
  };
}

function extractMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  return 'the inventory master refused the adjustment without a message';
}
