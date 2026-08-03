/**
 * Golden path full-flow: S6 — InPost labels
 *
 * Routing, tracking, PDF and dispatch, per ingested order.
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
import { manualCheckpoint } from '../../../src/support/manual-checkpoint';
import { assertTrackingBackfill, waitForTrackingBackfill } from '../../../src/support/shipments';
import { state } from './flow-state';
import { fullFlowSegment } from './segment';
import { requireOrder, readOrderSnapshot } from './helpers';

fullFlowSegment(() => {
  test('S6 — InPost labels: routing, tracking, PDF, dispatched (per order)', async ({ api, world, env, poll, jobs }) => {
    const testInfo = test.info();
    requireOrder();
    const inpost = world.connectionFor(PlatformType.inpost);
    test.skip(!inpost, 'no InPost connection on this stack');

    const shipmentSummaries: string[] = [];
    for (const [platform, order] of state.orders) {
      const source = world.connectionFor(platform);
      expect(source, `source connection for the ${platform} order`).toBeTruthy();

      // Ensure a routing rule maps the source delivery method to OL-managed InPost.
      const snapshot = readOrderSnapshot(order);
      const deliveryMethodId = snapshot.shipping?.methodId ?? 'default';
      // Deliberately unguarded: the PUT below is a full replace and this read
      // supplies the rules it preserves, so swallowing a transient failure into
      // `[]` would silently delete the operator's whole routing matrix for this
      // source connection - with no visible symptom, since a rule-less order
      // just routes to the `omp_fulfilled` default. Same reasoning as
      // `ensureCarrierRouting` in `src/support/shipments.ts`.
      const existing = await api.routingRules.list(source!.id);
      if (!existing.some((r) => r.sourceDeliveryMethodId === deliveryMethodId)) {
        await api.routingRules.replace(source!.id, [
          ...existing.map((r) => ({
            sourceDeliveryMethodId: r.sourceDeliveryMethodId,
            processorKind: r.processorKind,
            processorConnectionId: r.processorConnectionId,
          })),
          { sourceDeliveryMethodId: deliveryMethodId, processorKind: 'ol_managed_carrier', processorConnectionId: inpost!.id },
        ]);
      }

      // `E2E_PACZKOMAT_ID` overrides the buyer-selected pickup point when it is
      // unusable (Allegro-sandbox lockers are known not to exist in the InPost
      // sandbox); otherwise the point resolved from the order is used.
      //
      // `recipient` and `parcel.template` are mandatory in practice: the dispatch
      // service forwards both verbatim to the carrier mapper with no server-side
      // derivation from the order, and omitting either 500s (TypeError) or 502s
      // (preflight) instead of being defaulted (#1518). Derive the recipient from
      // the order snapshot the way an operator-facing UI would.
      const recipientAddress = snapshot.shippingAddress ?? {};
      const dispatch = await api.shipments.generateLabel({
        sourceConnectionId: source!.id,
        sourceDeliveryMethodId: deliveryMethodId,
        orderId: order.internalOrderId,
        deliveryIntent: 'pickup_point',
        recipient: {
          firstName: recipientAddress.firstName,
          lastName: recipientAddress.lastName,
          email: snapshot.customerEmail,
          phone: recipientAddress.phone,
        },
        parcel: { template: 'small' },
        // Same "no server-side derivation" rule as `recipient` / `parcel` above:
        // OL ingests the buyer-selected locker onto the order
        // (`orderSnapshot.pickupPoint.id`) but the dispatch preflight does NOT
        // read it, so a caller that omits `paczkomatId` gets
        // `502 preflight.missing-paczkomat-id` even though OL knows the locker.
        // Derive it from the order the way an operator-facing UI would, and let
        // `E2E_PACZKOMAT_ID` override when the buyer's point is unusable
        // (Allegro-sandbox lockers are not always real InPost-sandbox APMs).
        ...(env.paczkomatId ?? snapshot.pickupPoint?.id
          ? { paczkomatId: env.paczkomatId ?? snapshot.pickupPoint!.id! }
          : {}),
      });
      const shipment = dispatch.shipment ?? (await api.shipments.active(order.internalOrderId));
      expect(shipment, `a shipment was created for the ${platform} order`).toBeTruthy();
      state.shipmentIds.set(platform, shipment!.id);

      // ShipX renders the label document asynchronously — a fetch immediately
      // after create can fail even though the shipment is already `generated`,
      // so poll briefly instead of asserting the first response.
      await poll.until(
        () => api.shipments.getLabel(shipment!.id),
        (l) => l.ok && l.byteLength > 0,
        { message: `label PDF to become retrievable (${platform})`, timeoutMs: 60_000, intervalMs: 5_000 },
      );

      await api.shipments.notifyDispatched(shipment!.id).catch(() => undefined);
      const dispatched = await api.shipments.getById(shipment!.id);
      expect(['dispatched', 'in-transit', 'delivered']).toContain(dispatched.status);

      // Tracking-number backfill (#1521). The ShipX sandbox mints the tracking
      // number only once the shipment is confirmed and the carrier-generic
      // `marketplace.shipment.statusSync` poll (#838) has run — it is NOT present
      // right after label creation. Drive that poll and wait, with a bounded
      // budget, for OL to backfill `Shipment.trackingNumber` (the #1426 path).
      //
      // The classification lives in `assertTrackingBackfill` (shared with
      // tests/shipping/tracking-backfill.spec.ts): a timeout while the carrier
      // has ALREADY moved the parcel is a backfill regression and throws; only
      // the documented not-yet-confirmed sandbox state degrades to an
      // annotation, so an attended run is not failed by a sandbox-side delay
      // (see docs/manual-testing/e2e-golden-path.md).
      const backfill = await waitForTrackingBackfill(
        api,
        jobs,
        { shipmentId: shipment!.id, inpostConnectionId: inpost!.id },
        { timeoutMs: 120_000, intervalMs: 5_000 },
      );
      const unverifiedTracking = assertTrackingBackfill(backfill, platform);
      if (unverifiedTracking) {
        testInfo.annotations.push({ type: 'tracking', description: unverifiedTracking });
      }

      // Writeback to the marketplace is best-effort in code (annotated) and
      // asserted by the operator at the checkpoint below.
      testInfo.annotations.push({
        type: 'writeback',
        description: `${platform}: tracking ${backfill.trackingNumber ?? '(pending)'} — marketplace writeback verified via checkpoint`,
      });
      shipmentSummaries.push(
        `${platform}: shipment ${shipment!.id}, tracking ${backfill.trackingNumber ?? '(pending)'}, status ${dispatched.status}`,
      );
    }

    await manualCheckpoint(testInfo, {
      dashboard: 'InPost / ShipX manager + source marketplace orders',
      expect: [
        'Each shipment below exists with its tracking number',
        'Labels are downloadable and statuses are dispatched',
        'Each source order shows the shipped status and/or its tracking number (status/tracking writeback)',
      ],
      values: { shipments: shipmentSummaries.join(' | ') },
    });
  });
});
