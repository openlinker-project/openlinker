/**
 * Golden path full-flow: S5 — orders ready in OL
 *
 * Assert the purchase reached OL as a ready order and took channel stock down.
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
import type { OrderRecord } from '../../../src/api/api.types';
import { waitForOrder } from '../../../src/support/orders';
import { toMinorUnits } from '../../../src/support/parity';
import { state, SOLD_QTY } from './flow-state';
import { fullFlowSegment } from './segment';
import { requireProduct, resolveResumedSources, assertResumedOrderUsable, resolvePurchaseSources, requireDriverLine, readOrderSnapshot, resolvePrimaryMapping } from './helpers';

fullFlowSegment(() => {
  test('S5 — orders ready in OL + channel stock down', async ({ api, world, jobs, poll, env }) => {
    const testInfo = test.info();
    requireProduct();
    // A resumed run is scoped to the ONE order it was handed, so the purchase
    // sources are whatever that order actually came from — NOT the configured
    // `E2E_PURCHASE_PLATFORMS` list, which describes a purchase this run never
    // made and would strand the loop waiting on a second, non-existent order.
    const sources = env.resumeFromOrder
      ? resolveResumedSources(world)
      : resolvePurchaseSources(world, env.purchasePlatforms);
    expect(sources.length, 'a marketplace source connection is required').toBeGreaterThan(0);

    for (const source of sources) {
      let order: OrderRecord;
      if (env.resumeFromOrder) {
        // The order exists by definition here, so there is no arrival to
        // detect: re-read and VERIFY the one this run was handed rather than
        // burning `waitForOrder`'s 15-minute budget on an event already fired.
        order = await api.orders.getById(state.orders.get(source.platformType)!.internalOrderId);
        assertResumedOrderUsable(order, source, env, testInfo);
      } else {
        // Nudge ingestion, then wait for a new ready order (webhook or poll heals it).
        await jobs.trigger({ connectionId: source.id, jobType: 'marketplace.orders.poll' }).catch(() => undefined);
        order = await waitForOrder(api, {
          sourceConnectionId: source.id,
          snapshot: state.orderSnapshotByConnection.get(source.id),
        });
      }
      state.orders.set(source.platformType, order);

      // Amount parity: order line price/qty + totals + shipping.
      const snapshot = readOrderSnapshot(order);
      const currency = snapshot.totals.currency;
      const soldLine = requireDriverLine(snapshot, source.platformType);
      expect(soldLine.quantity, `sold quantity (${source.platformType})`).toBe(SOLD_QTY);

      // The per-line `lineTotal === price * qty` check that used to live here was
      // an identity between two spellings of the same expression - no order field
      // was read on the right-hand side, so a source adapter emitting a
      // mis-multiplied or double-discounted line total passed it. The subtotal
      // fold below is the real check: it derives the subtotal from the lines and
      // compares it against the total the ORDER reports.
      const computedSubtotal = snapshot.items.reduce(
        (sum, i) => sum + toMinorUnits(i.price, currency) * i.quantity,
        0,
      );

      // Total identity is tax-treatment-aware: with `inclusive` line prices the
      // computed subtotal already carries the tax, so adding `totals.tax` again
      // would double-count it; with `exclusive` prices the tax is additive.
      // (Absent treatment defaults to inclusive — both source adapters emit
      // buyer-paid gross prices.)
      const treatment = snapshot.totals.taxTreatment ?? 'inclusive';
      const taxMinor = toMinorUnits(snapshot.totals.tax ?? 0, currency);
      const shippingMinor = toMinorUnits(snapshot.totals.shipping ?? 0, currency);
      const expectedTotalMinor =
        treatment === 'exclusive'
          ? computedSubtotal + taxMinor + shippingMinor
          : computedSubtotal + shippingMinor;
      expect(
        toMinorUnits(snapshot.totals.total, currency),
        `order total identity (${treatment} tax treatment, ${source.platformType})`,
      ).toBe(expectedTotalMinor);

      // Channel stock delta: the SOURCE marketplace offer went down by SOLD_QTY.
      // This is the marketplace's OWN native decrement (it sold a unit) read
      // back through OL — NOT OL propagating a stock change to it. OL-driven
      // cross-channel write-back to the OTHER marketplaces is what S9's
      // propagation step exercises; here we only observe the selling channel
      // reflecting its own sale.
      const sourceKey = source.platformType;
      const channelBefore = state.channelBaseline.get(sourceKey);
      if (channelBefore !== undefined) {
        const mapping = await resolvePrimaryMapping(api, poll, source.id);
        // Poll for `<=` (not strict equality): on a dual-purchase run, ambient
        // inventory propagation can fold the OTHER marketplace's sale into this
        // channel before S9 runs, so `===` could never converge and would burn
        // the whole 120 s timeout. The exact value is asserted afterwards, so
        // any unexpected overshoot fails FAST with the observed quantity — only
        // the documented dual-purchase fold-in is tolerated (and annotated).
        const target = channelBefore - SOLD_QTY;
        const floor = channelBefore - SOLD_QTY * sources.length;
        const settled = await poll.until(
          () => api.listings.getOffer(mapping.id),
          (o) => o.availableQuantity <= target,
          {
            message: `${sourceKey} offer quantity to drop to at most ${target}`,
            timeoutMs: 120_000,
          },
        );
        if (settled.availableQuantity !== target) {
          expect(
            settled.availableQuantity,
            `${sourceKey} offer quantity after the sale (observed ${settled.availableQuantity}; ` +
              `only the dual-purchase cross-channel fold-in to ${floor} is tolerated before S9)`,
          ).toBe(floor);
          testInfo.annotations.push({
            type: 'channel-stock',
            description:
              `${sourceKey} offer already reflects every purchase (${settled.availableQuantity} = ` +
              `baseline ${channelBefore} - total sold) — ambient propagation folded in the other ` +
              'marketplace sale before S9',
          });
        }
      } else if (env.resumeFromOrder) {
        // Only annotate on the resume path: a full run legitimately reaches
        // here with no baseline too (Erli ships no OfferReader, so S4 captures
        // none), and adding an annotation there would change its report.
        testInfo.annotations.push({
          type: 'resume-degrade',
          description:
            `${sourceKey}: channel stock delta NOT CHECKED — the offer quantity BEFORE the sale ` +
            'is a pre-purchase reading a resumed run cannot observe, and the marketplace has ' +
            'already decremented it, so no honest delta is derivable after the fact',
        });
      }
    }
  });
});
