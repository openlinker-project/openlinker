/**
 * Golden path full-flow: S6x — status writeback (extension, #1574)
 *
 * ADR-027 explicit source-marketplace checkpoint.
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
import { manualCheckpoint } from '../../../src/support/manual-checkpoint';
import { state } from './flow-state';
import { fullFlowSegment } from './segment';
import { requireOrder } from './helpers';

fullFlowSegment(() => {
  // ── #1574 extensions ────────────────────────────────────────────────────
  // Everything below is an ADDITIVE extension for issue #1574. Each step is a
  // clearly-named, standalone test that reuses S0-S9 state (`state.orders`,
  // `state.shipmentIds`, …) and the same local helpers — none of it edits the
  // S0-S9 bodies above. See the PAUSE step's `extensionMultiLineOrDiscount` /
  // `extensionNipBuyer` operator hints for how S5x/S8x get real content to
  // check without staging an extra purchase.

  test('S6x — ADR-027 status writeback: explicit source-marketplace checkpoint (extension, #1574)', async ({
    world,
  }, testInfo) => {
    requireOrder();
    // S6 already prompts for this as one bullet among several; this step
    // exists so the writeback confirmation is its own auditable checkpoint
    // (own pass/fail annotation) rather than folded into S6's broader label
    // confirmation. No OL API can read an Allegro/Erli order's status back —
    // the relay (`OrderLifecycleRelayService`, ADR-027) is fire-and-forget
    // with no queryable result surface, so this stays an operator
    // confirmation against the real marketplace order pages.
    const summaries: string[] = [];
    for (const [platform] of state.orders) {
      const source = world.connectionFor(platform);
      const shipmentId = state.shipmentIds.get(platform);
      summaries.push(`${platform}: source connection ${source?.id ?? '(unknown)'}, shipment ${shipmentId ?? '(none)'}`);
    }
    await manualCheckpoint(testInfo, {
      dashboard: 'Source marketplace order pages (Allegro / Erli)',
      expect: [
        'Open each source order listed below on its OWN marketplace (not PrestaShop)',
        'The order shows a SHIPPED/DISPATCHED status (or equivalent)',
        'The order shows the InPost tracking number recorded in S6',
      ],
      values: { orders: summaries.join(' | ') },
    });
  });
});
