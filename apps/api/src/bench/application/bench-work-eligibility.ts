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

import type { BenchWorkAssignmentState, BenchWorkState } from './types/bench-work.types';

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

/** The fields the assignment rule reads. Deliberately not the whole view. */
export interface BenchAssignmentEligibilityInput {
  readonly assignedToUserId: string | null;
  readonly selfServeEligible: boolean;
}

/**
 * Which of the three states this parcel is in, for THIS viewer.
 *
 * `viewerId` is never optional: every route this feeds is `@Roles('admin',
 * 'operator', 'packer')`, so a caller always has an authenticated actor to ask
 * about.
 */
export function deriveBenchWorkAssignmentState(
  input: Pick<BenchAssignmentEligibilityInput, 'assignedToUserId'>,
  viewerId: string
): BenchWorkAssignmentState {
  if (input.assignedToUserId === null) return 'unassigned';
  return input.assignedToUserId === viewerId ? 'mine' : 'assigned-other';
}

/**
 * May THIS viewer claim (open, verify, reopen, undo) this parcel — ADR-074 /
 * #3336 / #3337.
 *
 * The list's own copy of `BenchParcelService.verifyUnit`'s guard, moved here
 * so list and write share the identical predicate (this file's "one rule, two
 * callers" discipline, restated for the assignment axis): `self-serve` always
 * wins, an unassigned parcel is open to anyone, and only a parcel locked to
 * someone else refuses. A frontend that hid the control on this answer alone
 * would still be a UX affordance ON TOP of `verifyUnit`'s own re-check, never
 * a substitute for it — the module note there says so explicitly.
 *
 * `verifyUnit` and `reopenParcel` (#3361 review) share this SAME predicate
 * rather than each restating it - a `BenchParcelService` that spelled the
 * three-condition rule twice is exactly the drift this file's discipline
 * exists to prevent. `viewerId` is nullable to serve `reopenParcel`, whose
 * `@CurrentUser()` is optional by design: `null` never equals a real
 * assignee, so an anonymous request against a locked parcel is excluded too -
 * the fail-closed reading of "who is asking" when nobody answers.
 *
 * **This is deliberate, not an oversight: a lock refuses its own author.**
 * The predicate tests only `selfServeEligible` / `assignedToUserId` /
 * `viewerId` — it does not carve out an exception for the admin or operator
 * who set the lock in the first place (`PATCH …/assignment` is
 * `@Roles('admin','operator')`, and `verifyUnit`'s route admits the same
 * roles alongside `packer`). So a supervisor who locks a parcel to a specific
 * packer cannot themselves pack it until they reassign it. That is
 * surprising the first time an operator hits it, which is exactly why it is
 * recorded here: the remedy already exists (reassign, or clear the lock),
 * and the lock is meant to be a hard assignment rather than one with a silent
 * escape hatch for whoever set it.
 */
export function isClaimableByViewer(
  input: BenchAssignmentEligibilityInput,
  viewerId: string | null
): boolean {
  if (input.selfServeEligible) return true;
  if (input.assignedToUserId === null) return true;
  return input.assignedToUserId === viewerId;
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
