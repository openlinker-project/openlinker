/**
 * Return Stage Fixtures (#2377, `W2-40`)
 *
 * **One table, consumed twice.** The mirror script proves that the TS and SQL
 * derivations share a vocabulary and a structure; it cannot prove they agree
 * about meaning, because they are written in different languages over different
 * shapes. This table is what proves that: the TS unit spec runs
 * `deriveReturnStage` over it, and the integration spec inserts each row and
 * reads the stage back through `countReturnsByStage`, asserting the SQL bucket
 * matches the same expectation.
 *
 * A combination with no stage is a TEST FAILURE, never a fallback — #2377's own
 * assumption. `awaiting_parcel` is the declared fallback arm, not a catch-all
 * for combinations nobody thought about.
 *
 * Lives on the `@openlinker/core/returns/testing` subpath, not the production
 * barrel: the int-spec lives in `apps/api` and must consume the IDENTICAL table
 * (two copies of a fixture set is two answers), but the API layer must not be one
 * autocomplete away from importing test data. Same rule the four existing
 * `/testing` sub-barrels follow.
 *
 * @module libs/core/src/returns/testing
 */
import type { ReturnStage, ReturnStageCounters } from '../domain/types/return-stage.types';

export interface ReturnStageFixture {
  /** What the row demonstrates, in the operator's terms. */
  name: string;
  counters: ReturnStageCounters;
  declined: boolean;
  expected: ReturnStage;
}

function counters(overrides: Partial<ReturnStageCounters> = {}): ReturnStageCounters {
  return {
    lineCount: 1,
    notReturnedLineCount: 0,
    quantityAdvised: 5,
    notReturnedQuantityAdvised: 0,
    quantityReceived: 0,
    quantityRestocked: 0,
    quantityScrapped: 0,
    ...overrides,
  };
}

export const RETURN_STAGE_FIXTURES: readonly ReturnStageFixture[] = [
  // --- awaiting_parcel -----------------------------------------------------
  {
    name: 'nothing has arrived',
    counters: counters(),
    declined: false,
    expected: 'awaiting_parcel',
  },
  {
    name: 'a return with no lines at all',
    counters: counters({ lineCount: 0, quantityAdvised: 0 }),
    declined: false,
    expected: 'awaiting_parcel',
  },

  // --- partially_received --------------------------------------------------
  {
    name: 'some units arrived, more still expected',
    counters: counters({ quantityReceived: 2 }),
    declined: false,
    expected: 'partially_received',
  },
  {
    name: 'partly arrived AND fully disposed — still not finished, more may turn up',
    counters: counters({ quantityReceived: 2, quantityRestocked: 2 }),
    declined: false,
    expected: 'partially_received',
  },

  // --- received_awaiting_disposition ---------------------------------------
  {
    name: 'everything expected arrived, nothing disposed',
    counters: counters({ quantityReceived: 5 }),
    declined: false,
    expected: 'received_awaiting_disposition',
  },
  {
    name: 'everything arrived, only some disposed',
    counters: counters({ quantityReceived: 5, quantityScrapped: 3 }),
    declined: false,
    expected: 'received_awaiting_disposition',
  },
  {
    name: 'a blocked restock leaves units undisposed, so the line still needs attention',
    counters: counters({ quantityReceived: 5, quantityRestocked: 0, quantityScrapped: 0 }),
    declined: false,
    expected: 'received_awaiting_disposition',
  },

  // --- disposed ------------------------------------------------------------
  {
    name: 'everything arrived and all of it was restocked',
    counters: counters({ quantityReceived: 5, quantityRestocked: 5 }),
    declined: false,
    expected: 'disposed',
  },
  {
    name: 'everything arrived and was split between restock and scrap',
    counters: counters({ quantityReceived: 5, quantityRestocked: 3, quantityScrapped: 2 }),
    declined: false,
    expected: 'disposed',
  },

  // --- the notReturnedQuantityAdvised subtraction ---------------------------
  {
    name: 'THE SUBTRACTION: one line disposed, one written off — finished, not "partially received"',
    counters: counters({
      lineCount: 2,
      notReturnedLineCount: 1,
      quantityAdvised: 5,
      notReturnedQuantityAdvised: 2,
      quantityReceived: 3,
      quantityRestocked: 3,
    }),
    declined: false,
    expected: 'disposed',
  },
  {
    name: 'a written-off line does not hide units still genuinely awaiting disposition',
    counters: counters({
      lineCount: 2,
      notReturnedLineCount: 1,
      quantityAdvised: 5,
      notReturnedQuantityAdvised: 2,
      quantityReceived: 3,
    }),
    declined: false,
    expected: 'received_awaiting_disposition',
  },
  {
    name: 'a written-off line leaves a genuinely partial receipt partial',
    counters: counters({
      lineCount: 3,
      notReturnedLineCount: 1,
      quantityAdvised: 9,
      notReturnedQuantityAdvised: 2,
      quantityReceived: 4,
    }),
    declined: false,
    expected: 'partially_received',
  },

  // --- not_returned --------------------------------------------------------
  {
    name: 'every line written off as never arriving',
    counters: counters({
      lineCount: 2,
      notReturnedLineCount: 2,
      quantityAdvised: 5,
      notReturnedQuantityAdvised: 5,
    }),
    declined: false,
    expected: 'not_returned',
  },
  {
    name: 'SOME lines written off is not `not_returned` — that arm needs every line',
    counters: counters({
      lineCount: 2,
      notReturnedLineCount: 1,
      quantityAdvised: 5,
      notReturnedQuantityAdvised: 2,
      quantityReceived: 1,
    }),
    declined: false,
    expected: 'partially_received',
  },

  // --- declined ------------------------------------------------------------
  {
    name: 'the source declined it',
    counters: counters(),
    declined: true,
    expected: 'declined',
  },
  {
    name: 'declined outranks every custody fact, including a completed disposition',
    counters: counters({ quantityReceived: 5, quantityRestocked: 5 }),
    declined: true,
    expected: 'declined',
  },
  {
    name: 'declined outranks a fully written-off return',
    counters: counters({
      lineCount: 1,
      notReturnedLineCount: 1,
      notReturnedQuantityAdvised: 5,
    }),
    declined: true,
    expected: 'declined',
  },
];
