/**
 * Golden path full-flow: S5x — multi-line / discount order (extension, #1574)
 *
 * Records what a multi-line or discounted purchase would have proven.
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
import { test } from '../../../src/fixtures/test';
import { narrowOrderSnapshot } from '../../../src/support/order-snapshot';
import { state } from './flow-state';
import { fullFlowSegment } from './segment';
import { requireOrder } from './helpers';

fullFlowSegment(() => {
  test('S5x — multi-line / discount order note (extension, #1574)', ({}, testInfo) => {
    requireOrder();
    // S5/S7/S8 already assert amount identity GENERICALLY over however many
    // lines an order has (they sum `snapshot.items`, never hardcode a single
    // line) — ADR-014 buyer-paid pricing is exercised for real whenever the
    // operator's purchase has more than one line and/or a discount. This step
    // adds no new assertions; it records whether that happened, so the report
    // is honest about whether non-trivial-order coverage actually ran.
    for (const [platform, order] of state.orders) {
      const snapshot = narrowOrderSnapshot<{ items?: unknown[] }>(order);
      const lineCount = Array.isArray(snapshot.items) ? snapshot.items.length : 0;
      testInfo.annotations.push({
        type: 'multi-line-coverage',
        description:
          lineCount > 1
            ? `${platform}: order has ${lineCount} lines — multi-line pricing parity exercised by S5/S7/S8`
            : `${platform}: order has a single line — multi-line/discount coverage NOT exercised this run ` +
              '(opt into the PAUSE step\'s extensionMultiLineOrDiscount hint for a future run)',
      });
    }
  });
});
