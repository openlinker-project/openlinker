/**
 * Bench work eligibility (#2418, `W3b-5`, story D2)
 *
 * *"A parcel I must not pack is refused, with the reason — and the refusal uses
 * the **same eligibility rule as the list**, so the two can never disagree."*
 *
 * This module is that rule. **One rule, two callers**, which is the whole of D2:
 * the list (`BenchWorkService`) reads it to colour a row, and opening a parcel
 * (`BenchParcelService`) reads it to refuse one. Two implementations that agree
 * today is precisely what the story forbids, because the day they stop agreeing
 * a packer is told a parcel is packable by one surface and unpackable by the
 * other, and neither is obviously wrong.
 *
 * #2416 shipped `deriveBenchWorkState` inline inside `BenchWorkService.toView`
 * and `BENCH_WORK_STATUSES` as a module-private const, so neither was reachable
 * by a second caller. Extracting them is the whole change; the derivation is
 * moved verbatim, and `bench-work-eligibility.spec.ts` pins that both callers
 * answer the same thing on one shared fixture table.
 *
 * ## Pure, and separate from the service, for the reason its sibling is
 *
 * `bench-work-ordering.ts` states it: the part a reader must be able to check
 * against the story is checked by nobody when it is buried in a service method.
 * No I/O, no clock, no injected dependency, no argument mutation — it qualifies
 * for `engineering-standards.md`'s pure-rule exception on all three counts.
 *
 * ## Why `'not-at-this-bench'` is a REFUSAL and not a fourth `BenchWorkState`
 *
 * The list SELECTS on `BENCH_WORK_STATUSES` / `BENCH_WORK_REQUEST_STATUSES`, so
 * a row it returns is always in-set and could never carry that value. Widening
 * the shipped state union for a fact one of its two consumers cannot produce
 * would put a permanently-unreachable value on the list DTO — the shape #2350
 * declined when it kept a shortfall out of `OrderHealthValues`. The open path
 * asks the two questions in order instead: *is this a bench parcel at all*, then
 * *what state is it in*.
 *
 * @module apps/api/src/bench/application
 */
import type {
  FulfillmentRequestStatus,
  FulfillmentWorkStatus,
} from '@openlinker/core/fulfillment';

import type { BenchWorkState } from './types/bench-work.types';

/**
 * Which execution states can appear on the bench.
 *
 * `closed` and `incomplete` are excluded: both are terminal and neither is
 * packable.
 *
 * **`cancelled` is INCLUDED, and that is not a slip against B1's "not yet
 * closed".** The mockup ships a "Do not pack these" section carrying exactly
 * the held and the cancelled — *"nothing to pack. Take the items back to the
 * shelf."* A cancelled parcel whose tote is physically on the bench is the one
 * case where silence is worse than speech: say nothing and the packer packs it.
 * Being terminal, such a row carries no actions at all — `deriveSupportedActions`
 * returns `[]` — including no expedite, which is correct and is stated here
 * because an empty `supportedActions` otherwise reads like a bug.
 *
 * **`on_hold` is defensive only.** Nothing in the tree writes
 * `status = 'on_hold'`: `placeHold` inserts a hold row and leaves the status
 * alone, so a held parcel arrives as `open` with a non-empty `activeHolds`.
 * Heldness is therefore derived from that array, never from this list — keying
 * on the status would have made every held parcel vanish from the one section
 * whose absence is dangerous.
 */
export const BENCH_WORK_STATUSES = [
  'open',
  'scheduled',
  'on_hold',
  'in_progress',
  'cancelled',
] as const satisfies readonly FulfillmentWorkStatus[];

/**
 * Story B1's *"accepted"*: a parcel the executor has not taken on is not this
 * bench's work yet, and one it rejected never will be.
 */
export const BENCH_WORK_REQUEST_STATUSES = [
  'accepted',
] as const satisfies readonly FulfillmentRequestStatus[];

/** The fields the rule reads. Deliberately not the whole view. */
export interface BenchEligibilityInput {
  readonly status: FulfillmentWorkStatus;
  readonly requestStatus: FulfillmentRequestStatus;
  /** `activeHolds.length` — heldness comes from the hold rows, never `status`. */
  readonly activeHoldCount: number;
}

/**
 * How a parcel must be treated, as a VALUE rather than as a colour (story B4).
 *
 * Moved verbatim from `BenchWorkService.toView`. `packable` says nothing about
 * whether the goods are on the shelf: it means only that nothing known to
 * OpenLinker forbids packing it.
 */
export function deriveBenchWorkState(input: BenchEligibilityInput): BenchWorkState {
  if (input.status === 'cancelled') return 'cancelled';
  if (input.activeHoldCount > 0) return 'held';
  return 'packable';
}

/** The refusal predicate. `packable` is the only state a parcel may be opened in. */
export function isPackableBenchState(state: BenchWorkState): boolean {
  return state === 'packable';
}

/**
 * Is this work a bench parcel at all — i.e. would the list have returned it?
 *
 * The SELECTION half of the rule, asked by the open path only. The list gets
 * this for free by filtering on the two constants above, which is exactly why
 * they are exported rather than restated: a status added to one and not the
 * other is a parcel the list shows and the bench refuses, or the reverse.
 *
 * The executor scope is deliberately NOT tested here — resolving whether a
 * connection is OpenLinker's own packing executor is a registry read, and this
 * module is pure. `BenchParcelService` asks that question with the same
 * resolver the list uses.
 */
export function isBenchWorkSelectable(input: BenchEligibilityInput): boolean {
  return (
    (BENCH_WORK_STATUSES as readonly string[]).includes(input.status) &&
    (BENCH_WORK_REQUEST_STATUSES as readonly string[]).includes(input.requestStatus)
  );
}
