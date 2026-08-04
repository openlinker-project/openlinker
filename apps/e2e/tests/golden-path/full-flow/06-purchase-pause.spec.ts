/**
 * Golden path full-flow: PAUSE — the manual purchase
 *
 * The human-in-the-loop stop: the operator buys the named offer, once per purchase platform.
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
import { snapshotOrderIds } from '../../../src/support/orders';
import { manualCheckpoint } from '../../../src/support/manual-checkpoint';
import { state, SOLD_QTY } from './flow-state';
import { fullFlowSegment } from './segment';
import { requireProduct, skipWhenResuming, resolvePurchaseSources } from './helpers';

fullFlowSegment(() => {
  test('PAUSE — operator buys the named offer (one stop per purchase platform)', async ({ api, world, env }) => {
    skipWhenResuming(env);
    const testInfo = test.info();
    requireProduct();
    const sources = resolvePurchaseSources(world, env.purchasePlatforms);
    test.skip(sources.length === 0, 'no marketplace source connection to buy from');

    // Snapshot BEFORE the first purchase so each source's "new order"
    // detection is clean regardless of when the operator checks out.
    for (const source of sources) {
      state.orderSnapshotByConnection.set(source.id, await snapshotOrderIds(api, source.id));
    }

    for (const source of sources) {
      await manualCheckpoint(testInfo, {
        dashboard: `MANUAL PURCHASE — ${source.platformType}`,
        expect: [
          `Buy exactly ${SOLD_QTY} unit of the primary-variant offer on ${source.platformType}`,
          'If the offer shows as draft/inactive on the marketplace, activate it in the seller panel first ' +
            '(a fresh Allegro offer may finish sandbox verification inactive, #1520)',
          'At checkout choose InPost Paczkomat (pickup point) delivery — S6 dispatches the label with pickup_point intent',
          'Pick a locker that EXISTS in the InPost sandbox — Allegro-sandbox lockers often do not; ' +
            'if the buyer-selected point turns out unusable, set E2E_PACZKOMAT_ID to a real ' +
            'InPost-sandbox APM before S6 runs',
          'Complete checkout so the order reaches the marketplace',
          '[OPTIONAL, #1574] To exercise non-trivial-order coverage, feel free to add a second ' +
            'line item and/or a discount to ONE purchase, and/or check out as a company buyer ' +
            'with a NIP — see extensionMultiLineOrDiscount/extensionNipBuyer below for details',
          'Then resume — the next purchase stop (if any) follows immediately',
        ],
        values: {
          marketplace: source.platformType,
          product: state.product!.name,
          primaryVariantSku: state.primaryVariant!.sku,
          primaryVariantEan: state.primaryVariant!.ean ?? state.primaryVariant!.gtin,
          quantity: SOLD_QTY,
          delivery: 'InPost Paczkomat (pickup point)',
          paczkomatOverride: env.paczkomatId ?? '(none — E2E_PACZKOMAT_ID unset)',
          // #1574 extension hints — optional, do not change the required
          // purchase count/quantity above. See the bullets below.
          extensionMultiLineOrDiscount:
            'OPTIONAL (#1574): add a second line item and/or apply a marketplace ' +
            'discount/coupon on ONE of the purchases to exercise buyer-paid pricing ' +
            '(ADR-014) end-to-end for a non-trivial order — S5x/S7/S8 assert generically ' +
            'over however many lines the order actually has, no extra purchase needed',
          extensionNipBuyer:
            'OPTIONAL (#1574): check out as a company/business buyer with a tax id (NIP) ' +
            'on ONE of the purchases — S8x reads the issued invoice\'s buyer tax id back',
        },
        // Genuinely fatal: nothing downstream (S5-S9) can run without the purchase.
        severity: 'fatal',
        // A manual storefront purchase routinely exceeds the default 30-minute
        // window (a prior run expired mid-checkout) — give the operator 2 hours.
        timeoutMs: 120 * 60_000,
      });
    }
  });
});
