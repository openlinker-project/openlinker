/**
 * The ONE bench-eligibility table (#2418 story D2; #2420 story G4)
 *
 * Extracted from `bench-work-eligibility.spec.ts` so that the two SERVICES can
 * be driven over the same rows as the rule, which is what story G4 asks for.
 *
 * #2418 proved that `deriveBenchWorkState` answers correctly. That is necessary
 * and not sufficient: a service is free to call the shared rule and then think
 * better of the answer, or to stop calling it altogether, and a spec that
 * exercises only the pure function cannot see either. G4's claim is about the
 * SURFACES — *"the bench and the worklist never disagree"* — so the surfaces are
 * what the table is read against.
 *
 * Three readers, one table: the rule (`bench-work-eligibility.spec.ts`), the
 * list (`bench-work.service.spec.ts`) and the parcel read
 * (`bench-parcel.service.spec.ts`). Each uses the harness it already has, which
 * is why this is a table rather than a third harness — the alternative was a
 * ~150-line copy of builders that already exist twice.
 *
 * A row added here is automatically asserted by all three.
 *
 * @module apps/api/src/bench/application/__tests__
 */
import type { FulfillmentRequestStatus, FulfillmentWorkStatus } from '@openlinker/core/fulfillment';

import type { BenchParcelRefusal } from '../types/bench-parcel.types';
import type { BenchWorkState } from '../types/bench-work.types';

export interface BenchEligibilityFixture {
  readonly name: string;
  readonly status: FulfillmentWorkStatus;
  readonly requestStatus: FulfillmentRequestStatus;
  readonly activeHoldCount: number;
  readonly expected: BenchWorkState;
}

export const BENCH_ELIGIBILITY_FIXTURES: readonly BenchEligibilityFixture[] = [
  {
    name: 'an accepted open parcel with no hold may be packed',
    status: 'open',
    requestStatus: 'accepted',
    activeHoldCount: 0,
    expected: 'packable',
  },
  {
    name: 'a hold makes it unpackable even while the status stays open',
    // Nothing in the tree writes `status = 'on_hold'` — `placeHold` inserts a
    // hold row and leaves the status alone — so heldness MUST come from the
    // rows. Keying on the status would have hidden every held parcel from the
    // one section whose absence is dangerous.
    status: 'open',
    requestStatus: 'accepted',
    activeHoldCount: 1,
    expected: 'held',
  },
  {
    name: 'cancellation outranks a hold',
    status: 'cancelled',
    requestStatus: 'accepted',
    activeHoldCount: 2,
    expected: 'cancelled',
  },
  {
    name: 'in progress with no hold may be packed',
    status: 'in_progress',
    requestStatus: 'accepted',
    activeHoldCount: 0,
    expected: 'packable',
  },
  {
    name: 'a scheduled parcel with no hold may be packed',
    status: 'scheduled',
    requestStatus: 'accepted',
    activeHoldCount: 0,
    expected: 'packable',
  },
  {
    name: 'several holds are still one held parcel',
    status: 'in_progress',
    requestStatus: 'accepted',
    activeHoldCount: 3,
    expected: 'held',
  },
];

/**
 * What the parcel read must answer for a given state.
 *
 * The refusal is `null` exactly when the list would colour the row green, and
 * this function is the ONLY place that correspondence is written down — both
 * service specs read it, so neither can drift from the other by restating it.
 */
export function expectedRefusalFor(state: BenchWorkState): BenchParcelRefusal | null {
  // The narrow return type states the invariant the body implements: `packable`
  // maps to `null`, so what survives is exactly the refusal vocabulary. Widening
  // it to `BenchWorkState | null` would understate that.
  return state === 'packable' ? null : state;
}
