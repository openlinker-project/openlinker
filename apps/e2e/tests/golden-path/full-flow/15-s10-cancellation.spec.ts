/**
 * Golden path full-flow: S10 — cancellation + stock restore (extension, #1574)
 *
 * Cancel the order and assert the stock comes back.
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
import { ApiError } from '../../../src/api/api-error';
import { narrowOrderSnapshot } from '../../../src/support/order-snapshot';
import { manualCheckpoint } from '../../../src/support/manual-checkpoint';
import { PollTimeoutError, pollFailureCause } from '../../../src/support/poller';
import { state, SOLD_QTY } from './flow-state';
import { fullFlowSegment } from './segment';
import { requireOrder, readLiveOfferOrNull, resolvePrimaryMapping } from './helpers';

fullFlowSegment(() => {
  test('S10 — cancellation + stock restore (extension, #1574)', async ({ api, world, jobs, poll }, testInfo) => {
    requireOrder();
    // No scriptable marketplace-side cancel exists in this suite (no Allegro/
    // Erli REST client) — per the issue's own Assumptions, cancellation
    // degrades to an attended checkpoint. `severity: 'observational'` — this
    // is the last segment, so a failure here must not mask the rest of the
    // run's pass/fail.
    const entries = [...state.orders.entries()];
    test.skip(entries.length === 0, 'no purchased order to cancel');
    const [platform, order] = entries[0];

    const source = world.connectionFor(platform);
    const mapping = source ? await resolvePrimaryMapping(api, poll, source.id) : null;
    const preCancel = mapping ? await readLiveOfferOrNull(api, mapping.id) : null;

    const verdict = await manualCheckpoint(testInfo, {
      dashboard: `${platform} seller panel — MANUAL CANCELLATION`,
      expect: [
        `Cancel the ${platform} order placed in this run (product: ${state.product?.name ?? '(unknown)'})`,
        'Confirm the cancellation is accepted on the marketplace',
        'Then resume',
      ],
      values: {
        platform,
        preCancelOfferQuantity: preCancel?.availableQuantity ?? '(unreadable — no OfferReader)',
      },
      severity: 'observational',
      timeoutMs: 30 * 60_000,
    });
    if (!verdict.passed) {
      // Nothing was cancelled on the marketplace, so there is no ingestion or
      // stock restore to observe - but say so on the report. A bare `return`
      // left every assertion below unrun with no trace, and the checkpoint's
      // `observational` severity meant the segment reported green. (The verdict
      // itself is now on the terminal gate's ledger, which fails the run.)
      testInfo.annotations.push({
        type: 'cancellation-unverified',
        description:
          `${platform}: the cancellation checkpoint was ${verdict.timedOut ? 'never answered' : 'FAILED'}` +
          ` - cancelled-order ingestion and OfferStockRestorer stock restore both went UNVERIFIED`,
      });
      return;
    }

    // Nudge ingestion (webhook + poll both converge here per #1512/#1574),
    // then wait for the order's snapshot status to flip to 'cancelled'.
    //
    // The poll IS the assertion: it throws `PollTimeoutError` if the status
    // never flips. Re-asserting its own predicate on the returned value
    // afterwards (which this used to do) can never fail by construction.
    if (source) {
      await jobs.trigger({ connectionId: source.id, jobType: 'marketplace.orders.poll' }).catch(() => undefined);
    }
    await poll.until(
      () => api.orders.getById(order.internalOrderId),
      (o) => narrowOrderSnapshot<{ status?: string }>(o).status === 'cancelled',
      { message: `${platform} order to be ingested as cancelled`, timeoutMs: 180_000, intervalMs: 5_000 },
    );

    // Offer-stock restore (`OfferStockRestorer`, #1146): the channel quantity
    // should recover by SOLD_QTY. Degrades to an annotation when the channel
    // has no live OfferReader (Erli) or no restore capability.
    if (mapping && preCancel) {
      const restoreTarget = preCancel.availableQuantity + SOLD_QTY;
      try {
        // Poll for `>=` then assert EXACT, the pattern S5/S9 use: an overshoot
        // past the restored value is a real error and must be reported with the
        // observed quantity, not folded into the `>=` predicate that let it in.
        const restored = await poll.until(
          () => api.listings.getOffer(mapping.id),
          (o) => o.availableQuantity >= restoreTarget,
          { message: `${platform} offer quantity to be restored after cancellation`, timeoutMs: 120_000 },
        );
        expect(
          restored.availableQuantity,
          `${platform} offer quantity restored after cancellation (expected the pre-cancel ` +
            `${preCancel.availableQuantity} + ${SOLD_QTY})`,
        ).toBe(restoreTarget);
      } catch (error) {
        // Only a genuine non-convergence degrades. A bare `catch` also
        // swallowed the exact-value mismatch above and every transport error
        // the probe raised, so the one reachable failure in this segment could
        // not turn it red.
        if (!(error instanceof PollTimeoutError)) throw error;
        const cause = pollFailureCause(error);
        if (cause instanceof ApiError && cause.status >= 500) throw error;
        testInfo.annotations.push({
          type: 'stock-restore-degrade',
          description: `${platform}: offer quantity did not visibly restore within the timeout — verify manually (OfferStockRestorer may not be implemented for this adapter, or restore timing exceeded the budget)`,
        });
      }
    } else {
      testInfo.annotations.push({
        type: 'stock-restore-degrade',
        description: `${platform}: no live OfferReader — stock-restore verified via the checkpoint only`,
      });
    }
  });
});
