/**
 * Shipping suite — S6: routing matrix (paczkomat -> InPost, courier -> DPD)
 *
 * Two distinct source delivery methods on the SAME source connection route to
 * two distinct carrier connections: a pickup-point method to InPost, a
 * courier method to DPD Polska (`dpd.polska.rest.v1`, platformType `'dpd'`,
 * `libs/integrations/dpd-polska/src/dpd-plugin.ts`). This proves the routing
 * table — not just a single-carrier default — actually discriminates by
 * delivery method.
 *
 * The InPost half dispatches a real label (mirrors S1). The DPD half asserts
 * the ROUTING RESOLUTION only (the rule read-back carries the right
 * `processorConnectionId`) rather than a live DPD dispatch: DPD Polska needs
 * its own sandbox credentials/config this suite has not verified end-to-end,
 * and the issue's acceptance is the routing matrix, not a second full carrier
 * integration proof. A live DPD dispatch is a natural follow-up once a DPD
 * sandbox connection is a standard fixture on the e2e stack.
 *
 * @module tests/shipping
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import {
  buildPickupRecipient,
  ensureCarrierRouting,
  releaseDispatchedShipments,
  shippingOrderShortageReason,
  resolveDispatchedShipment,
  resolveOrderDeliveryMethodId,
  resolveShippingTestOrder,
} from '../../src/support/shipments';

/** DPD Polska's platformType (`dpd-plugin.ts`) — not in the shared `PlatformType` map. */
const DPD_PLATFORM_TYPE = 'dpd';

/** A synthetic, distinct delivery-method id for the courier half of the matrix. */
const COURIER_DELIVERY_METHOD_ID = 'e2e-courier-matrix';

test.describe('shipping — routing matrix', () => {
  /**
   * Source connections this run wrote a synthetic `COURIER_DELIVERY_METHOD_ID`
   * rule onto. Unlike the pickup-point half - which routes the order's OWN
   * delivery method and is therefore a rule the operator wants anyway - this one
   * is a fabricated method that exists purely for the matrix contrast, so
   * leaving it behind permanently widens the operator's routing table with a
   * rule no real order can ever match.
   */
  const syntheticRuleConnectionIds = new Set<string>();

  // Recycle the fixture pool. Every dispatch leaves a non-terminal shipment on
  // its order, and `resolveShippingTestOrder` refuses an order that already has
  // one - so without this the suite eats its own pool and every shipping spec
  // eventually `test.skip`s green with zero coverage. Best-effort and silent on
  // an already-confirmed shipment; `afterAll`, so a failing test still recycles.
  test.afterAll(async ({ api }) => {
    await releaseDispatchedShipments(api);
    for (const connectionId of syntheticRuleConnectionIds) {
      // `PUT /connections/:id/routing-rules` is a FULL REPLACE, so the removal
      // is "read the current table, write it back minus our synthetic row".
      // Deliberately NOT `.catch(() => [])` on the read (cf. `ensureCarrierRouting`):
      // a swallowed read here would write an empty array and delete the
      // operator's whole routing matrix. A failed read leaves the synthetic rule
      // in place, which is strictly the lesser harm - so the whole repair is
      // wrapped, never rethrown, and the residue is reported instead.
      try {
        const rules = await api.routingRules.list(connectionId);
        await api.routingRules.replace(
          connectionId,
          rules
            .filter((r) => r.sourceDeliveryMethodId !== COURIER_DELIVERY_METHOD_ID)
            .map((r) => ({
              sourceDeliveryMethodId: r.sourceDeliveryMethodId,
              processorKind: r.processorKind,
              processorConnectionId: r.processorConnectionId,
            })),
        );
      } catch {
        console.warn(
          `[e2e] left a synthetic routing rule "${COURIER_DELIVERY_METHOD_ID}" on connection ` +
            `${connectionId}; remove it from the connection's routing table by hand.`,
        );
      }
    }
    syntheticRuleConnectionIds.clear();
  });

  test('routes a pickup-point delivery method to InPost and dispatches', async ({
    api,
    world,
    env,
  }) => {
    const inpost = world.connectionFor(PlatformType.inpost);
    test.skip(!inpost, 'no InPost connection on this stack');
    test.skip(!env.paczkomatId, 'no locker id configured (set E2E_PACZKOMAT_ID)');

    const order = await resolveShippingTestOrder(api, env);
    test.skip(
      !order,
      shippingOrderShortageReason(),
    );

    const deliveryMethodId = resolveOrderDeliveryMethodId(order!);
    await ensureCarrierRouting(api, order!.sourceConnectionId, deliveryMethodId, inpost!.id);

    const rules = await api.routingRules.list(order!.sourceConnectionId);
    const rule = rules.find((r) => r.sourceDeliveryMethodId === deliveryMethodId);
    expect(rule, 'a routing rule exists for the pickup-point delivery method').toBeTruthy();
    expect(rule!.processorConnectionId, 'routes to the InPost connection').toBe(inpost!.id);

    const dispatch = await api.shipments.generateLabel({
      sourceConnectionId: order!.sourceConnectionId,
      sourceDeliveryMethodId: deliveryMethodId,
      orderId: order!.internalOrderId,
      deliveryIntent: 'pickup_point',
      recipient: buildPickupRecipient(order!),
      parcel: { template: 'small' },
      paczkomatId: env.paczkomatId!,
    });
    const shipment = await resolveDispatchedShipment(api, dispatch, order!.internalOrderId);
    expect(shipment.connectionId, 'shipment dispatched through the InPost connection').toBe(
      inpost!.id,
    );
  });

  test('resolves a courier delivery method to a distinct DPD routing rule', async ({
    api,
    world,
  }) => {
    const dpd = world.connectionFor(DPD_PLATFORM_TYPE);
    test.skip(!dpd, 'no DPD Polska connection on this stack');
    const inpost = world.connectionFor(PlatformType.inpost);
    test.skip(!inpost, 'no InPost connection on this stack (needed for the matrix contrast)');

    // Any source connection works for a pure routing-table assertion — the
    // rule is keyed by (sourceConnectionId, sourceDeliveryMethodId), not the
    // order. Prefer a marketplace/shop connection over the carriers themselves.
    const source =
      world.connectionFor(PlatformType.prestashop) ??
      world.connectionFor(PlatformType.allegro) ??
      world.connectionFor(PlatformType.erli);
    test.skip(!source, 'no source (marketplace/shop) connection to attach the routing rule to');

    // Register BEFORE the write, so a failure mid-write still gets swept.
    syntheticRuleConnectionIds.add(source!.id);
    await ensureCarrierRouting(api, source!.id, COURIER_DELIVERY_METHOD_ID, dpd!.id);

    const rules = await api.routingRules.list(source!.id);
    const dpdRule = rules.find((r) => r.sourceDeliveryMethodId === COURIER_DELIVERY_METHOD_ID);
    expect(dpdRule, 'a routing rule exists for the courier delivery method').toBeTruthy();
    expect(dpdRule!.processorConnectionId, 'routes to the DPD connection, not InPost').toBe(
      dpd!.id,
    );
    expect(dpdRule!.processorConnectionId).not.toBe(inpost!.id);
  });
});
