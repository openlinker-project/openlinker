/**
 * Golden path full-flow: S7 — orders created in PrestaShop
 *
 * Assert the destination order exists and master stock went down.
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
import { captureStock, waitForStockDelta } from '../../../src/support/stock';
import { assertMoneyEqual } from '../../../src/support/parity';
import { state, SOLD_QTY } from './flow-state';
import { fullFlowSegment } from './segment';
import { requireOrder, requireDriverLine, readOrderSnapshot, buildPrestashopClient } from './helpers';

fullFlowSegment(() => {
  test('S7 — orders created in PrestaShop + master stock down', async ({ api, world, jobs, poll, env }) => {
    const testInfo = test.info();
    requireOrder();
    const prestashop = world.connectionFor(PlatformType.prestashop);
    test.skip(!prestashop, 'no PrestaShop destination connection');

    // Wait for the destination sync to PrestaShop to complete — one PS order
    // per marketplace purchase. PS-side line/total parity per order runs below.
    const psSyncByPlatform = new Map<string, { externalOrderId: string | null }>();
    for (const [platform, order] of state.orders) {
      // A resumed run inherits whatever destination-sync verdict the order
      // already carries, and OL never retries a failed one on its own — so a
      // stale failure (a since-fixed connection URL, an expired secret) would
      // make the poll below burn its full budget waiting for a state that can
      // no longer change. Re-drive ingestion first: `syncOrderFromSource` is
      // idempotent per (order, destination) under a lock (#906/#909), so this
      // re-attempts the destination write without duplicating the order. A
      // normal run needs no nudge — the sync it is waiting for is the one that
      // ingestion just kicked off.
      if (env.resumeFromOrder) {
        const source = world.connections.find((c) => c.id === order.sourceConnectionId);
        const externalOrderId = readOrderSnapshot(order).orderNumber;
        if (source && externalOrderId) {
          await jobs
            .triggerAndWait({
              connectionId: source.id,
              jobType: 'marketplace.order.sync',
              payload: { externalOrderId },
            })
            .catch(() => undefined);
        }
      }
      const synced = await poll.until(
        () => api.orders.getById(order.internalOrderId),
        (o) => o.syncStatus.some((s) => s.destinationConnectionId === prestashop!.id && s.status === 'synced'),
        { message: `the ${platform} order to sync to PrestaShop`, timeoutMs: 180_000 },
      );
      const psSync = synced.syncStatus.find((s) => s.destinationConnectionId === prestashop!.id);
      expect(psSync?.externalOrderId, `PrestaShop external order id (${platform} order)`).toBeTruthy();
      psSyncByPlatform.set(platform, { externalOrderId: psSync!.externalOrderId ?? null });
    }

    // Drive the master-stock refresh explicitly (PS decremented on order
    // create; OL only sees it after a master inventory sync) instead of waiting
    // on ambient scheduling, then wait for the delta.
    await jobs.triggerAndWait(
      { connectionId: prestashop!.id, jobType: 'master.inventory.syncAll' },
    );
    // The master delta is the SUM of every marketplace sale (one PS order each).
    // A resumed run has no pre-purchase baseline to subtract from (see
    // `E2E_RESUME_FROM_ORDER`), and the only value it could invent — the
    // post-sale reading plus the sold quantity — would make this assertion
    // compare a number against itself. Record what went unchecked instead.
    if (state.olBaseline) {
      await waitForStockDelta(api, state.olBaseline, {
        variantId: state.primaryVariant!.id,
        soldQty: SOLD_QTY * state.orders.size,
      });
    } else {
      const observed = await captureStock(api, [state.primaryVariant!.id]);
      testInfo.annotations.push({
        type: 'resume-degrade',
        description:
          'OL master stock delta NOT CHECKED — the pre-purchase master availability is ' +
          'unobservable in a resumed run; the PrestaShop order parity below still runs ' +
          `(observed availability for ${state.primaryVariant!.id}: ` +
          `${observed.get(state.primaryVariant!.id) ?? '(none)'})`,
      });
    }

    // PrestaShop order parity (webservice), when the key is available: totals,
    // shipping, and the sold line (qty + buyer-paid unit price, ADR-014).
    const ps = buildPrestashopClient(world);
    if (ps) {
      for (const [platform, order] of state.orders) {
        const psExternalOrderId = psSyncByPlatform.get(platform)?.externalOrderId;
        if (!psExternalOrderId) continue;
        const psOrder = await ps.getOrder(psExternalOrderId);
        const snapshot = readOrderSnapshot(order);
        const currency = snapshot.totals.currency;

        // Fail loudly when PS omits the paid total — a silent skip here would
        // pass the segment without ever comparing an amount.
        expect(
          psOrder.totalPaidTaxIncl,
          `PrestaShop order exposes total_paid_tax_incl (${platform})`,
        ).toBeTruthy();
        assertMoneyEqual(
          snapshot.totals.total,
          psOrder.totalPaidTaxIncl!,
          currency,
          `PS order total (tax incl) vs OL order total (${platform})`,
        );
        assertMoneyEqual(
          snapshot.totals.shipping ?? 0,
          psOrder.totalShippingTaxIncl ?? 0,
          currency,
          `PS order shipping (tax incl) vs OL order shipping (${platform})`,
        );

        // Line items: the sold line exists with matching quantity and the
        // buyer-paid unit price.
        expect(psOrder.rows.length, `PS order carries line rows (${platform})`).toBeGreaterThan(0);
        const soldLine = requireDriverLine(snapshot, platform);
        const soldEan = state.primaryVariant!.ean ?? state.primaryVariant!.gtin;
        // Fall back to `rows[0]` ONLY when no PS row carries a barcode at all
        // (an older order, or a product whose combinations predate EAN entry).
        // Falling back while other rows DO carry barcodes would compare the
        // driver line against an unrelated product's row and still pass.
        const matchedRow = soldEan
          ? psOrder.rows.find((r) => r.productEan13 === soldEan)
          : undefined;
        const anyRowCarriesEan = psOrder.rows.some((r) => !!r.productEan13);
        if (soldEan && anyRowCarriesEan) {
          expect(
            matchedRow,
            `PS order carries a row for the driver EAN ${soldEan} (${platform}) - ` +
              `rows present: ${JSON.stringify(psOrder.rows.map((r) => r.productEan13))}`,
          ).toBeTruthy();
        }
        const psRow = matchedRow ?? psOrder.rows[0];
        expect(psRow.productQuantity, `PS line quantity (${platform})`).toBe(soldLine.quantity);
        if (psRow.unitPriceTaxIncl !== null) {
          assertMoneyEqual(
            soldLine.price,
            psRow.unitPriceTaxIncl,
            currency,
            `PS line unit price (buyer-paid source price, ADR-014, ${platform})`,
          );
        }
      }
    }
  });
});
