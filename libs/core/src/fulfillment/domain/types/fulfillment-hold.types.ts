/**
 * Fulfillment Hold — the work-grain hold row (#2392, DESIGN §5.2)
 *
 * *"Holds are first-class rows (`fulfillment_holds`, ≤10 active, shared reason
 * vocabulary per adjudication #4)."* A hold is what puts a `FulfillmentWork`
 * into the `on_hold` execution state; `hold` / `release_hold` in
 * `FulfillmentWorkActionValues` name the acts that write and clear one.
 *
 * ## The reason vocabulary is BORROWED, not restated
 *
 * `HoldReason` is imported **type-only** from `@openlinker/core/order-lifecycle`
 * and is this leaf's SECOND entry in `ZERO_SIBLING_EDGE_LEAVES` (the first being
 * `FulfillmentCancellationReason`). Design adjudication #4 keeps ONE vocabulary
 * across the two hold grains — order and work — so restating the union here is
 * the duplication ADR-053 § Alternatives rejects by name. The import is
 * cycle-safe on the two conditions that table requires, and both must hold: it
 * is type-only (erased at build time, so no runtime edge exists at all), and the
 * target is itself a registered zero-sibling-edge leaf exporting no NestJS
 * module. **The second condition expires the day `order-lifecycle` gains a
 * module**, which its own barrel warns is possible; that would need
 * re-deriving, not silently inheriting.
 *
 * ## Why the reason is NOT narrowed on read
 *
 * The house rule is narrow-or-fallback, never a blind cast — and it cannot be
 * followed here. Narrowing needs `isHoldReason`, which is a **value** import,
 * and `barrel-purity.spec.ts` rejects a sibling value import from a registered
 * leaf *unconditionally, regardless of the allow-set*. `automation` narrows this
 * same union precisely because it is not a leaf. So the column is read back with
 * a boundary cast, following the in-tree `ReturnLine` precedent
 * (`custodyState` / `moneyState` / `disposition`). The write path is what keeps
 * that honest: the port accepts a `HoldReason`, so every row this context writes
 * is valid by construction, and the cast only widens rows read back.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.2
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 */
import type { HoldReason } from '@openlinker/core/order-lifecycle';

/**
 * The maximum number of simultaneously-active holds one work object may carry.
 *
 * DESIGN §5.2's "≤10 active". Deliberately **not** a database constraint — see
 * `FulfillmentWorkRepository.placeHold` for why a partial unique index cannot
 * express N>1 and why a trigger would hold in production and silently not in
 * the `synchronize`-built test schema.
 */
export const FULFILLMENT_HOLD_ACTIVE_LIMIT = 10;

/** One hold placed against one work object. Released, never deleted. */
export interface FulfillmentHold {
  readonly id: string;
  readonly fulfillmentWorkId: string;
  readonly reason: HoldReason;
  readonly note: string | null;
  /** Exactly one of the two actor fields is set — `CHK_fulfillment_holds_actor`. */
  readonly placedByUserId: string | null;
  readonly placedByService: string | null;
  readonly placedAt: Date;
  readonly releasedAt: Date | null;
  readonly releasedByUserId: string | null;
  readonly releaseNote: string | null;
}

/** Whether a hold is still suspending its work object. */
export function isFulfillmentHoldActive(hold: FulfillmentHold): boolean {
  return hold.releasedAt === null;
}
