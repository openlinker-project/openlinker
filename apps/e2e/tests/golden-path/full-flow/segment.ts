/**
 * Golden path full-flow: the per-segment harness
 *
 * Every segment spec in this directory is wrapped in `fullFlowSegment(...)`,
 * which reproduces the four guarantees the flow used to get for free when all
 * of S0-S9 lived in one `test.describe.configure({ mode: 'serial' })` block:
 *
 *   1. **Attended opt-in.** The flow drives a manual buyer purchase and mutates
 *      six external systems, so it self-skips unless `E2E_ATTENDED=1`.
 *   2. **Order.** Playwright runs a project's spec files in sorted path order
 *      with `workers: 1` / `fullyParallel: false`, which is why the files carry
 *      a numeric prefix (`01-`, `02-`, …) matching the business order rather
 *      than their S-numbers — the purchase PAUSE sits between S4 and S5, and
 *      the #1574 extensions run after S9.
 *   3. **Fail-fast.** `serial` mode skips the remaining tests in a group once
 *      one fails. That is file-scoped, so it cannot span sibling files; the
 *      abort marker below restores it. It is written to `outputDir` rather than
 *      held in memory precisely because Playwright discards the worker process
 *      after a failure — an in-memory flag would be lost with it, and the next
 *      segment would run against an empty `state` and report a confusing
 *      assertion failure instead of an honest skip. Playwright clears
 *      `outputDir` at the start of each run, so the marker never leaks between
 *      runs.
 *   4. **One-shot resume seeding.** `E2E_RESUME_FROM_ORDER` seeds S5-onward
 *      state from an order a previous session produced. That must happen once
 *      per run, not once per file.
 *
 * @module tests/golden-path/full-flow
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '../../../src/fixtures/test';
import { seedStateFromExistingOrder } from './helpers';

/**
 * Guard for the resume seeding. Process-scoped like `state` itself, and read
 * only on the non-aborted path, so a worker restart cannot re-seed a run that
 * has already given up.
 */
let resumeSeeded = false;

function abortMarkerPath(): string {
  return join(test.info().project.outputDir, '.full-flow-aborted');
}

function readAbortMarker(): string | null {
  const path = abortMarkerPath();
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
}

function writeAbortMarker(failedSegment: string): void {
  const path = abortMarkerPath();
  mkdirSync(test.info().project.outputDir, { recursive: true });
  writeFileSync(path, failedSegment);
}

/**
 * Register one segment of the attended full flow.
 *
 * `register` contains the segment's `test(...)` call(s) verbatim — the wrapper
 * only supplies the group, the gates and the hooks.
 */
export function fullFlowSegment(register: () => void): void {
  test.describe('golden path — full flow (S0-S9)', () => {
    test.describe.configure({ mode: 'serial' });

    // Belt-and-suspenders attended opt-in. The `test:e2e` default script already
    // excludes `full-flow`, and `test:e2e:full-flow` sets E2E_ATTENDED=1 — but a
    // bare `playwright test --project=full-flow` (or a developer running the whole
    // suite by hand) must not silently enter the 2h-per-purchase manual pause.
    // Set E2E_ATTENDED=1 to run this heavily-mutating, human-driven flow.
    test.skip(!process.env.E2E_ATTENDED, 'attended flow — set E2E_ATTENDED=1 to run');

    // Resume mode (`E2E_RESUME_FROM_ORDER`): seed everything S5 onward reads from
    // an order that already exists, so a run that only needs the post-purchase
    // half doesn't pay again for a fresh product, a fresh offer, the ~40-minute
    // wait for it to leave `szkic`, and a second human purchase. A worker hook
    // rather than a lazy seed inside S5, so a bad order id fails the whole group
    // up front instead of surfacing as a confusing mid-flow assertion.
    test.beforeAll(async ({ api, world, env }) => {
      if (!env.resumeFromOrder) return;
      if (resumeSeeded) return;
      // An aborted run must not pay for seeding it will never use.
      if (readAbortMarker() !== null) return;
      resumeSeeded = true;
      await seedStateFromExistingOrder(api, world, env.resumeFromOrder);
    });

    test.beforeEach(() => {
      const failedSegment = readAbortMarker();
      test.skip(
        failedSegment !== null,
        `an earlier segment of this flow failed (${failedSegment}) — the state this ` +
          'segment reads was never produced',
      );
    });

    test.afterEach(({}, testInfo) => {
      // `skipped` is not a failure: a segment that self-skips (no connection for
      // its platform, resume mode, a missing optional secret) must not abort the
      // rest of the flow — that is exactly how `serial` behaved.
      if (testInfo.status === 'skipped') return;
      if (testInfo.status !== testInfo.expectedStatus) writeAbortMarker(testInfo.title);
    });

    register();
  });
}
