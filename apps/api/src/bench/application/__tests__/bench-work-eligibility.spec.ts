/**
 * One eligibility rule, two callers (#2418, story D2)
 *
 * *"The refusal uses the same eligibility rule as the list, so the two can never
 * disagree."* The failure this prevents is specific: a packer told a parcel is
 * packable by the list and unpackable by the bench, with neither answer
 * obviously wrong and nothing in the product to adjudicate between them.
 *
 * #2416 had the rule INLINE in `BenchWorkService.toView`, so opening a parcel
 * would have had to restate it — the "two implementations that agree today" D2
 * forbids. This spec pins the extraction: one fixture table, and BOTH callers
 * are asserted to answer from it.
 *
 * @module apps/api/src/bench/application/__tests__
 */
import {
  BENCH_WORK_REQUEST_STATUSES,
  BENCH_WORK_STATUSES,
  deriveBenchWorkState,
  isBenchWorkSelectable,
  isPackableBenchState,
} from '../bench-work-eligibility';
import { BENCH_ELIGIBILITY_FIXTURES } from './bench-eligibility.fixture';

/**
 * The ONE table, now shared with the two SERVICES (#2420, story G4).
 *
 * It moved to `bench-eligibility.fixture.ts` so that `bench-work.service.spec.ts`
 * and `bench-parcel.service.spec.ts` can be driven over the same rows using the
 * harnesses they already have. Proving the pure rule answers correctly is
 * necessary and not sufficient: a service that stopped calling it, or thought
 * better of its answer, is invisible from here.
 */
const FIXTURES = BENCH_ELIGIBILITY_FIXTURES;

describe('bench work eligibility (#2418, story D2)', () => {
  describe('the shared derivation', () => {
    it.each(FIXTURES)('$name', ({ status, requestStatus, activeHoldCount, expected }) => {
      expect(deriveBenchWorkState({ status, requestStatus, activeHoldCount })).toBe(expected);
    });
  });

  describe('the refusal predicate reads that derivation', () => {
    it.each(FIXTURES)('$name', ({ status, requestStatus, activeHoldCount, expected }) => {
      const state = deriveBenchWorkState({ status, requestStatus, activeHoldCount });
      // The parcel read refuses whenever the list would not colour the row
      // green. Same input, same function, therefore the same answer — which is
      // the whole of what D2 asks for.
      expect(isPackableBenchState(state)).toBe(expected === 'packable');
    });
  });

  describe('the selection half, shared with the list query', () => {
    it('admits every status the list filters on', () => {
      for (const status of BENCH_WORK_STATUSES) {
        expect(
          isBenchWorkSelectable({ status, requestStatus: 'accepted', activeHoldCount: 0 })
        ).toBe(true);
      }
    });

    it.each(['closed', 'incomplete'] as const)(
      'refuses `%s`, which the list also excludes',
      (status) => {
        expect(
          isBenchWorkSelectable({ status, requestStatus: 'accepted', activeHoldCount: 0 })
        ).toBe(false);
      }
    );

    it('refuses a request status the list does not select', () => {
      // Story B1's "accepted": a parcel the executor has not taken on is not
      // this bench's work yet, and one it rejected never will be.
      expect(
        isBenchWorkSelectable({ status: 'open', requestStatus: 'submitted', activeHoldCount: 0 })
      ).toBe(false);
      expect(BENCH_WORK_REQUEST_STATUSES).toEqual(['accepted']);
    });

    it('keeps `cancelled` selectable, which reads like a bug and is not', () => {
      // The mockup ships a "Do not pack these" section carrying exactly the held
      // and the cancelled. A cancelled parcel whose tote is physically on the
      // bench is the one case where silence is worse than speech: say nothing
      // and the packer packs it.
      expect(BENCH_WORK_STATUSES).toContain('cancelled');
    });
  });
});
