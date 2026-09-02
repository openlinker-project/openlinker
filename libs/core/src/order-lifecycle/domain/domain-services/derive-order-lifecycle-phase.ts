/**
 * Derive Order Lifecycle Phase (#2307, ADR-059)
 *
 * The one pure function ADR-059's decision rests on. Nothing persists a phase:
 * it is recomputed from facts, each of which has its own grain and its own
 * single writer. This file is the **canonical narration** of that derivation;
 * the SQL `CASE` twin (#2309), the FE mirror (#2310) and the mirror-check
 * script (#2311) must all encode exactly the ladder below.
 *
 * **The precedence is imported, never restated.**
 * `OrderLifecyclePhaseValues` is declared in precedence order and
 * `ORDER_LIFECYCLE_PHASE_PRECEDENCE` is the ordinal computed from it; the `if`
 * ladder here walks that same order top-down, and the colocated spec pins the
 * ladder's observed outcome against the imported table so a reordering of the
 * vocabulary fails a test rather than silently changing every operator's list.
 *
 * **No clock, deliberately.** There is no `now` input and no `Date.now()` call.
 * A phase fed by a clock is uninvalidatable — the same order would derive
 * differently on two reads with no fact having changed, and neither the SQL
 * twin nor a cached projection could agree with it. Elapsed-time concerns stay
 * in the separate clock-fed `deriveSlaState` control.
 *
 * **Seven inputs, three of them not yet wired.** `activeHoldReason`,
 * `hasOpenAmendment` and `vendorDeclaredPhase` have no persisted source in Wave
 * 1a and are accepted nullable/false, so the later waves that produce them are
 * **input wiring, not a signature change**. (Design §6.3's prose says "six
 * inputs" while its own brace list names seven; the list is right and the docs
 * PR corrects the prose.)
 *
 * **Zero behaviour change on landing** — #2309 is the first consumer.
 *
 * @module libs/core/src/order-lifecycle/domain/domain-services
 * @see docs/architecture/adrs/059-order-lifecycle-derived-phase.md
 * @see OrderLifecyclePhaseValues — the precedence-ordered vocabulary this walks
 */
import type {
  FulfillmentRollupState,
  OrderRecordStatus,
} from '@openlinker/core/orders/types';

import type { HoldReason } from '../types/hold-reason.types';
import type { LifecycleAuthority } from '../types/lifecycle-authority.types';
import type { OrderLifecyclePhase } from '../types/order-lifecycle-phase.types';

/**
 * The seven facts the phase is derived from. Each field names its persisted
 * source, or the wave that will give it one.
 */
export interface DeriveOrderLifecyclePhaseInput {
  /**
   * `order_records.cancelledAt` — first-write-wins, and the fact #2284 made
   * trustworthy by keying the provisioning predicate on it. Non-null wins over
   * everything below.
   */
  cancelledAt: Date | null;

  /**
   * `order_records.fulfillmentState` — the per-order shipment rollup (#1108).
   * `null` ≡ `'not-shipped'` per that vocabulary's own NULL contract, and is
   * normalised once at the top of the ladder so no arm re-tests for it. The
   * rollup has no `in-transit` value: `'dispatched'` covers
   * `generated | dispatched | in-transit`, so a dispatched-not-delivered order
   * is what derives to `in_transit`.
   */
  fulfillmentState: FulfillmentRollupState | null;

  /**
   * The order-grain hold, if one is active. **No persisted source until Wave
   * 2** (`order_holds` plus its denormalised column); pass `null` until then.
   */
  activeHoldReason: HoldReason | null;

  /**
   * Whether an ADR-044 change proposal is outstanding against the order.
   * **No persisted source until Wave 2** widens `order_changes.kind` (W1c-6
   * lands returns only); pass `false` until then.
   */
  hasOpenAmendment: boolean;

  /**
   * `order_records.recordStatus` — the ingest-gap axis. The two non-`ready`
   * values (`awaiting_mapping`, `source_deleted`) are what derive to `blocked`.
   */
  recordStatus: OrderRecordStatus;

  /**
   * Who authors this order's lifecycle facts, bound per order at ingestion.
   * Always `{ mode: 'openlinker' }` in Wave 1a, so both posture-B arms below
   * are unreachable in production until Wave 4 and are unit-tested only.
   */
  authority: LifecycleAuthority;

  /**
   * The **classified** side of the posture-B vendor pair: the vendor's
   * verbatim label (`vendorLifecycleLabel`) is persisted separately and
   * rendered as-is, while an adapter that CAN classify its own label
   * additionally reports this phase via `describeLifecycle().declaredPhase`.
   * `null` therefore means "the vendor is the authority and declared nothing OL
   * can classify" — which is precisely what `vendor_authoritative` reports.
   * **No persisted source until Wave 4** — both this classified phase and the
   * verbatim `vendorLifecycleLabel` beside it are posture-B columns, and label
   * persistence is Wave 4's too. (#2309 is the SQL twin and API projection
   * only: it adds no column, so its `CASE` writes this arm as a documented
   * `FALSE` placeholder.)
   */
  vendorDeclaredPhase: OrderLifecyclePhase | null;
}

/**
 * Derive the operator-facing phase. Pure, synchronous, total, clock-free.
 *
 * The ladder is flat and literal — no scoring, no sort, no computed phase
 * strings — so the mirror-check script (#2311) can read the precedence straight
 * out of it, and so a reviewer can see the whole rule at once.
 */
export function deriveOrderLifecyclePhase(
  input: DeriveOrderLifecyclePhaseInput,
): OrderLifecyclePhase {
  // NULL ≡ 'not-shipped'; normalised once so no arm below re-tests for null.
  const fulfillmentState: FulfillmentRollupState =
    input.fulfillmentState ?? 'not-shipped';

  // 1. `cancelled` — a cancel wins over everything, including a dispatched or
  //    delivered shipment, which shows as contradicting DETAIL rather than as a
  //    competing phase (design §6.2). It also outranks both posture-B arms:
  //    a cancellation OL recorded is OL's own fact about its own order.
  if (input.cancelledAt !== null) {
    return 'cancelled';
  }

  // 2. Posture B — the vendor holds lifecycle authority. When it declared a
  //    phase, that phase IS the state and is returned verbatim rather than
  //    re-derived: when OL is not the authority, OL's facts are observations,
  //    not the state. When it declared nothing classifiable, the honest answer
  //    is `vendor_authoritative` — OL renders the vendor's label rather than
  //    fabricating a phase (ADR-059, "never fabricate").
  if (input.authority.mode === 'external') {
    return input.vendorDeclaredPhase ?? 'vendor_authoritative';
  }

  // 3-5. Observed fulfilment outcomes, in rollup precedence. The `never` arm
  //      makes adding a rollup value a build failure here.
  switch (fulfillmentState) {
    case 'delivered':
      return 'delivered';
    case 'dispatched':
      return 'in_transit';
    case 'failed':
      return 'fulfillment_failed';
    case 'not-shipped':
      break;
    default: {
      const exhaustive: never = fulfillmentState;
      return exhaustive;
    }
  }

  // 6. `held` outranks `amending` because a hold is a DECISION someone made
  //    while an amendment is only a request.
  if (input.activeHoldReason !== null) {
    return 'held';
  }

  // 7. An OL-authored intention in flight.
  if (input.hasOpenAmendment) {
    return 'amending';
  }

  // 8. `blocked` — OL's own ingest incompleteness, below OL-authored
  //    intentions. The `never` arm makes adding a record status a build failure.
  switch (input.recordStatus) {
    case 'awaiting_mapping':
    case 'source_deleted':
      return 'blocked';
    case 'ready':
      break;
    default: {
      const exhaustive: never = input.recordStatus;
      return exhaustive;
    }
  }

  // 9. Residual.
  return 'ready';
}
