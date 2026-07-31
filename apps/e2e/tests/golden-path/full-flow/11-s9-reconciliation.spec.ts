/**
 * Golden path full-flow: S9 — final reconciliation
 *
 * Stock, cross-channel propagation and statuses, end to end.
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
import { PlatformType } from '../../../src/world/world';
import { captureStock, assertStockDelta } from '../../../src/support/stock';
import { state, SOLD_QTY } from './flow-state';
import { fullFlowSegment } from './segment';
import { requireOrder, buildWooClient, readLiveOfferOrNull, resolvePrimaryMapping } from './helpers';

fullFlowSegment(() => {
  test('S9 — final reconciliation: stock, cross-channel propagation, statuses', async ({ api, world, jobs, poll, env }) => {
    const testInfo = test.info();
    requireOrder();
    const totalSold = SOLD_QTY * state.orders.size;
    // OL master stock delta holds — the SUM of every marketplace sale. Absent
    // on the resume path for the same reason as S7: there is no pre-purchase
    // baseline to subtract from, and inventing one from the post-sale reading
    // would assert a number against itself.
    const current = await captureStock(api, state.variantIds);
    if (state.olBaseline) {
      assertStockDelta(state.olBaseline, current, { variantId: state.primaryVariant!.id, soldQty: totalSold });
    } else {
      testInfo.annotations.push({
        type: 'resume-degrade',
        description:
          'OL master stock delta NOT CHECKED — no pre-purchase baseline exists in a resumed ' +
          `run (observed availability for ${state.primaryVariant!.id}: ` +
          `${current.get(state.primaryVariant!.id) ?? '(none)'})`,
      });
    }

    // Every order is ready and synced to at least one destination.
    for (const [platform, tracked] of state.orders) {
      const order = await api.orders.getById(tracked.internalOrderId);
      expect(order.recordStatus, `${platform} order record status`).toBe('ready');
      expect(
        order.syncStatus.some((s) => s.status === 'synced'),
        `${platform} order synced to a destination`,
      ).toBe(true);
    }

    // Cross-channel propagation (#14): push the post-sale master availability
    // to EVERY mapped marketplace offer — buying on one channel must drop the
    // other channels too — then verify each channel that OL can read back.
    const anchor = world.connections.find((c) => c.status === 'active') ?? world.connections[0];
    expect(anchor, 'a connection to anchor the propagation job on').toBeTruthy();
    await jobs.triggerAndWait(
      {
        connectionId: anchor.id,
        jobType: 'inventory.propagateToMarketplaces',
        payload: {
          productId: state.product!.id,
          variantId: state.primaryVariant!.id,
          inventoryUpdatedAt: new Date().toISOString(),
        },
      },
    );

    const expectedChannelQty = new Map<string, number>();
    for (const [platform, baseline] of state.channelBaseline) {
      if (platform !== 'woocommerce') expectedChannelQty.set(platform, baseline - totalSold);
    }
    for (const platform of [PlatformType.allegro, PlatformType.erli]) {
      const connection = world.connectionFor(platform);
      if (!connection) continue;
      // S4 only lists on a destination that someone will buy from
      // (`E2E_PURCHASE_PLATFORMS`), so a platform outside that set has no offer
      // for this product and `resolvePrimaryMapping` would poll a mapping that
      // was never going to exist. Skipping costs real coverage — propagating a
      // sale to a channel that did NOT sell is the point of this check — so say
      // so on the report rather than passing quietly.
      if (!env.purchasePlatforms.includes(platform)) {
        testInfo.annotations.push({
          type: 'cross-channel',
          description:
            `${platform} has no offer this run (not in E2E_PURCHASE_PLATFORMS) — ` +
            'post-sale propagation to a non-selling channel went UNVERIFIED',
        });
        continue;
      }
      const mapping = await resolvePrimaryMapping(api, poll, connection.id);
      const offer = await readLiveOfferOrNull(api, mapping.id);
      const expectedQty = expectedChannelQty.get(platform);
      if (offer === null) {
        testInfo.annotations.push({
          type: 'cross-channel',
          description:
            `${platform} offer ${mapping.externalId} is not readable through OL (no OfferReader) — ` +
            'verify the post-sale quantity on the marketplace dashboard manually',
        });
        continue;
      }
      if (expectedQty === undefined) {
        testInfo.annotations.push({
          type: 'cross-channel',
          description: `${platform}: no pre-sale baseline captured — observed quantity ${offer.availableQuantity}`,
        });
        continue;
      }
      // Poll for `<=` then assert exact: an overshoot below the fully-converged
      // value is a genuine error and must fail fast with the observed quantity,
      // not burn the 120 s timeout on a predicate that can never hold.
      const settled = await poll.until(
        () => api.listings.getOffer(mapping.id),
        (o) => o.availableQuantity <= expectedQty,
        {
          message: `${platform} offer quantity to reach at most ${expectedQty} after cross-channel propagation`,
          timeoutMs: 120_000,
        },
      );
      expect(
        settled.availableQuantity,
        `${platform} offer quantity after cross-channel propagation`,
      ).toBe(expectedQty);
    }

    // WooCommerce stock re-check after the purchase (#14): the S2 baseline is
    // read back through the WC REST API. #1498 added base-port quantity
    // write-back on woocommerce.restapi.v3 (WooCommerceOfferManagerAdapter,
    // OfferManager) via ShopProduct mappings — but it is default-OFF on new
    // connections and mutually exclusive with InventoryMaster per connection.
    // In the golden path the WC connection is the master catalogue
    // (InventoryMaster), so write-back is not active on it and a stale value is
    // annotated as expected rather than failed. Exercising the write-back delta
    // needs a dedicated non-master WC connection with write-back enabled — a
    // Phase-2 follow-up, not part of this master-catalogue flow.
    const wc = buildWooClient(world);
    const wcBaseline = state.channelBaseline.get('woocommerce');
    if (wc && wcBaseline !== undefined && state.wcProductId !== undefined) {
      // Re-read by the WC product id captured in S2 — a stable handle that holds
      // regardless of whether the publisher set a SKU on this stack.
      const wcProduct = await wc.getProduct(state.wcProductId);
      const wcAfter = wcProduct?.stockQuantity ?? null;
      // Expected against the run's TOTAL sold (one sale per purchase platform),
      // not a single SOLD_QTY — a dual-purchase run drops WC stock twice once a
      // write-back path exists.
      const wcExpected = wcBaseline - totalSold;
      testInfo.annotations.push({
        type: 'cross-channel',
        description:
          wcAfter === wcExpected
            ? `WooCommerce stock reflects the sale: ${wcAfter} (baseline ${wcBaseline} - sold ${totalSold})`
            : `WooCommerce stock after sale: ${wcAfter ?? '(unknown)'} (baseline ${wcBaseline}, ` +
              `expected ${wcExpected}) - WC quantity write-back (#1498) is default-OFF and ` +
              'mutually exclusive with InventoryMaster, so it is not active on this master-catalogue ' +
              'WC connection; not a failure (write-back delta is a Phase-2 follow-up)',
      });
    } else if (env.resumeFromOrder) {
      testInfo.annotations.push({
        type: 'resume-degrade',
        description:
          'WooCommerce post-sale stock NOT CHECKED — S2 (which publishes the product, records ' +
          'its WC id and reads the pre-sale quantity) does not run in a resumed run, so there ' +
          'is neither a WC product handle nor a baseline to compare against',
      });
    }
  });
});
