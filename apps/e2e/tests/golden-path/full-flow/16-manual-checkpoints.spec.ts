/**
 * Golden path full-flow: Terminal gate: manual checkpoints
 *
 * Fails the run when an external-dashboard checkpoint was failed or never answered.
 *
 * Segment of the attended S0-S9 flow across all six systems. The segments share
 * `state` and run in file order in one worker — see `./segment.ts` for the
 * ordering, fail-fast and attended-gate contract, and
 * `docs/manual-testing/e2e-golden-path.md` for the flow itself.
 *
 * WARNING: MUTATING and ATTENDED. Run only via
 * `pnpm --filter @openlinker/e2e test:e2e:full-flow`, in a coordinated session
 * against a stack you control.
 *
 * @module tests/golden-path/full-flow
 */
import { test, expect } from '../../../src/fixtures/test';
import { manualCheckpointFailures } from '../../../src/support/manual-checkpoint';
import { fullFlowSegment } from './segment';

fullFlowSegment(() => {
  /**
   * Terminal gate for the attended half of the run.
   *
   * Every external-dashboard checkpoint is `observational` on purpose: the flow
   * is fail-fast (see `./segment.ts`), so a checkpoint that failed its own test
   * would skip every downstream segment. The cost of that choice is that nothing else can
   * turn the run red - start the run, walk away, and each checkpoint waits out
   * its 30 minutes, records a FAIL, and S3/S4/S6/S8/S10 all report green while
   * nobody looked at Allegro, Erli, InPost or KSeF. This test is the missing
   * consequence, and it is LAST so it costs no downstream coverage.
   *
   * The failure ledger `manualCheckpointFailures()` reads is module state in
   * `src/support/manual-checkpoint.ts`, so — like `flow-state.ts` — it spans the
   * sibling segment files only because they share one worker process. On the
   * path where that stops being true (a failed segment discards the worker) this
   * gate never runs: the abort marker skips it, and the run is already red.
   */
  test('every manual checkpoint was confirmed by the operator', () => {
    const failures = manualCheckpointFailures();
    expect(
      failures.map((f) => `${f.dashboard}: ${f.timedOut ? 'UNANSWERED' : 'FAILED'}${f.note ? ` - ${f.note}` : ''}`),
      `${failures.length} manual checkpoint(s) were failed or never answered - the surfaces they ` +
        'guard are unverified, so this attended run is not a pass',
    ).toEqual([]);
  });
});
