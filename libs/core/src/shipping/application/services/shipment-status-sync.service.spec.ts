/**
 * ShipmentStatusSyncService — unit tests (#838, #1947)
 *
 * Covers the waybill relay and the state that bounds it: the `>= dispatched`
 * gate (a `generated` shipment backfills `Shipment.trackingNumber` but notifies
 * nobody), the at-most-once claim on `Shipment.waybillRelayedAt`, the
 * terminal-status guard (`cancelled`/`failed` suppress the relay but `delivered`
 * must NOT), and the transient-vs-structural split on `unsupported`.
 *
 * @module libs/core/src/shipping/application/services
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type {
  IOrderLifecycleRelayService,
  OrderLifecycleRelayResult,
} from '@openlinker/core/orders';

import { Shipment } from '../../domain/entities/shipment.entity';
import type { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type { TrackingSnapshot } from '../../domain/types/tracking-snapshot.types';
import { ShipmentStatusSyncService } from './shipment-status-sync.service';

const CARRIER = 'conn-inpost';
const SOURCE = 'conn-allegro';
const PS1 = 'conn-ps-1';

function makeShipment(overrides: Partial<Shipment> = {}): Shipment {
  // `?? 'prov-abc'` would mask an explicit `null`, but `=== undefined` keeps
  // null pass-through clean without a non-null assertion.
  return new Shipment(
    overrides.id ?? 'ol_shipment_1',
    overrides.orderId ?? 'ol_order_1',
    overrides.connectionId ?? CARRIER,
    overrides.shippingMethod ?? 'paczkomat',
    overrides.status ?? 'dispatched',
    overrides.providerShipmentId === undefined ? 'prov-abc' : overrides.providerShipmentId,
    overrides.paczkomatId ?? null,
    overrides.trackingNumber ?? null,
    overrides.labelPdfRef ?? null,
    overrides.dispatchedAt ?? new Date('2026-05-27T10:00:00.000Z'),
    overrides.deliveredAt ?? null,
    overrides.cancelledAt ?? null,
    overrides.failedAt ?? null,
    overrides.errorMessage ?? null,
    overrides.createdAt ?? new Date('2026-05-27T09:00:00.000Z'),
    overrides.updatedAt ?? new Date('2026-05-27T10:00:00.000Z'),
    overrides.sourceDeliveryMethodId ?? null,
    overrides.carrier === undefined ? null : overrides.carrier,
    overrides.deliveryIntent ?? null,
    overrides.providerCode ?? null,
    overrides.waybillRelayedAt ?? null,
    overrides.direction ?? 'outbound',
    overrides.reservationConsumedAt ?? null,
    overrides.fulfillmentWorkId ?? null,
  );
}

/** Relay result helper — one target per connection, `applied` unless overridden. */
function relayResult(
  ...targets: OrderLifecycleRelayResult['targets']
): OrderLifecycleRelayResult {
  return { targets: targets.length > 0 ? targets : [{ connectionId: SOURCE, outcome: 'applied' }] };
}

function snapshot(overrides: Partial<TrackingSnapshot> = {}): TrackingSnapshot {
  return {
    status: 'dispatched',
    ...overrides,
  };
}

describe('ShipmentStatusSyncService', () => {
  let shipments: jest.Mocked<ShipmentRepositoryPort>;
  let integrations: jest.Mocked<IIntegrationsService>;
  let relay: jest.Mocked<IOrderLifecycleRelayService>;
  let getTracking: jest.Mock;
  let service: ShipmentStatusSyncService;

  beforeEach(() => {
    shipments = {
      create: jest.fn(),
      findMany: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findActiveByOrderId: jest.fn(),
      findByProviderShipmentId: jest.fn(),
      findBranchOneByOrderAndConnection: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      // Claim is won by default; individual tests override to simulate a
      // concurrent trigger or an already-relayed waybill.
      claimWaybillRelay: jest.fn().mockResolvedValue(true),
      releaseWaybillRelay: jest.fn().mockResolvedValue(undefined),
      listDispatchedAwaitingReservationConsume: jest.fn(),
      claimReservationConsume: jest.fn(),
      claimFulfillmentWorkLink: jest.fn(),
    } as unknown as jest.Mocked<ShipmentRepositoryPort>;

    relay = {
      relay: jest.fn().mockResolvedValue(relayResult()),
    } as unknown as jest.Mocked<IOrderLifecycleRelayService>;

    getTracking = jest.fn();

    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    (integrations.getCapabilityAdapter as jest.Mock).mockResolvedValue({ getTracking });
    // Carrier-hint resolution (`getAdapter`) feeds the relay's `carrier`.
    (integrations.getAdapter as jest.Mock).mockResolvedValue({
      metadata: { platformType: 'inpost' },
    });

    service = new ShipmentStatusSyncService(shipments, integrations, relay, {
      recompute: jest.fn(),
    });
  });

  describe('page mechanics', () => {
    it('returns zero counters and wraps to 0 when the page is empty', async () => {
      shipments.findMany.mockResolvedValue({ items: [], total: 0 });
      const result = await service.sync(CARRIER, { limit: 50 });
      expect(result).toEqual({
        scanned: 0,
        updated: 0,
        propagated: 0,
        failed: 0,
        total: 0,
        nextOffset: 0,
      });
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('keeps the offset stationary when the page is empty mid-scan (so the cursor can advance externally)', async () => {
      // Empty page is a degenerate read; consumed = offset + 0 = offset. The
      // caller's cursor advancer sees the same offset on the next tick — that's
      // expected for the OfferStatusSync precedent too.
      shipments.findMany.mockResolvedValue({ items: [], total: 100 });
      const result = await service.sync(CARRIER, { offset: 50, limit: 50 });
      expect(result.nextOffset).toBe(50);
    });

    it('wraps nextOffset to 0 when the scan reaches total', async () => {
      const s = makeShipment({ trackingNumber: '6800000001', status: 'dispatched' });
      getTracking.mockResolvedValue(snapshot({ status: 'delivered', trackingNumber: '6800000001', deliveredAt: new Date('2026-05-28') }));
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      const result = await service.sync(CARRIER, { offset: 0, limit: 50 });
      expect(result.nextOffset).toBe(0);
      expect(result.scanned).toBe(1);
    });

    it('skips shipments without a providerShipmentId without calling the carrier', async () => {
      const s = makeShipment({ providerShipmentId: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      const result = await service.sync(CARRIER, { limit: 50 });
      expect(getTracking).not.toHaveBeenCalled();
      expect(shipments.update).not.toHaveBeenCalled();
      expect(result.failed).toBe(0);
    });

    it('counts a failure when getTracking throws but continues the page', async () => {
      const failing = makeShipment({ id: 'ol_shipment_a' });
      const succeeding = makeShipment({ id: 'ol_shipment_b' });
      shipments.findMany.mockResolvedValue({ items: [failing, succeeding], total: 2 });
      getTracking
        .mockRejectedValueOnce(new Error('carrier 500'))
        .mockResolvedValueOnce(snapshot({ status: 'delivered', deliveredAt: new Date('2026-05-28') }));
      const result = await service.sync(CARRIER, { limit: 50 });
      expect(result).toMatchObject({ scanned: 2, failed: 1, updated: 1 });
    });
  });

  describe('status transitions', () => {
    it('advances into a terminal state (delivered) with deliveredAt set', async () => {
      const s = makeShipment({ trackingNumber: '6800000001' });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      const deliveredAt = new Date('2026-05-28T12:00:00.000Z');
      getTracking.mockResolvedValue(snapshot({ status: 'delivered', deliveredAt }));
      await service.sync(CARRIER, { limit: 50 });
      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ status: 'delivered', deliveredAt }),
      );
    });

    it('advances into terminal cancelled with cancelledAt populated', async () => {
      const s = makeShipment({ trackingNumber: '6800000001' });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'cancelled' }));
      await service.sync(CARRIER, { limit: 50 });
      const patch = shipments.update.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(patch.status).toBe('cancelled');
      expect(patch.cancelledAt).toBeInstanceOf(Date);
    });

    it('does NOT advance generated → dispatched (left to #837 notifyDispatched)', async () => {
      const s = makeShipment({ status: 'generated', trackingNumber: '6800000001' });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched' }));
      await service.sync(CARRIER, { limit: 50 });
      expect(shipments.update).not.toHaveBeenCalled();
    });

    it('does NOT advance dispatched → in-transit (non-terminal forward)', async () => {
      const s = makeShipment({ status: 'dispatched', trackingNumber: '6800000001' });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'in-transit' }));
      await service.sync(CARRIER, { limit: 50 });
      expect(shipments.update).not.toHaveBeenCalled();
    });
  });

  describe('waybill relay (#1947)', () => {
    it('backfills tracking on a generated shipment WITHOUT relaying to anyone', async () => {
      // #837's notifyDispatched owns the generated → dispatched transition and
      // its own at-most-once notify; #838 must not race it.
      const s = makeShipment({ status: 'generated', trackingNumber: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'generated', trackingNumber: 'NEW123' }));

      const result = await service.sync(CARRIER, { limit: 50 });

      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ trackingNumber: 'NEW123' }),
      );
      expect(relay.relay).not.toHaveBeenCalled();
      expect(shipments.claimWaybillRelay).not.toHaveBeenCalled();
      expect(result.propagated).toBe(0);
      expect(result.updated).toBe(1);
    });

    it('relays the waybill to every participant on a dispatched shipment, with carrier hint and origin', async () => {
      const s = makeShipment({ status: 'dispatched', trackingNumber: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched', trackingNumber: 'NEW456' }));

      const result = await service.sync(CARRIER, { limit: 50 });

      expect(relay.relay).toHaveBeenCalledTimes(1);
      expect(relay.relay).toHaveBeenCalledWith({
        internalOrderId: s.orderId,
        // Origin is the carrier connection, so the relay reaches the SOURCE
        // marketplace as well as every destination shop.
        originConnectionId: CARRIER,
        event: {
          type: 'dispatched',
          trackingNumber: 'NEW456',
          carrier: { platformType: 'inpost' },
        },
      });
      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ trackingNumber: 'NEW456' }),
      );
      expect(result.propagated).toBe(1);
    });

    it('DELIVERED still relays — a delivered parcel unambiguously shipped', async () => {
      // Regression guard: `delivered` is terminal, so a naive
      // "skip the relay on any terminal status" guard would consume the
      // null→value transition and lose the waybill forever on the FASTEST
      // orders (one poll can carry delivered + the first waybill together).
      const s = makeShipment({ status: 'dispatched', trackingNumber: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(
        snapshot({
          status: 'delivered',
          trackingNumber: 'FAST999',
          deliveredAt: new Date('2026-05-28'),
        }),
      );

      await service.sync(CARRIER, { limit: 50 });

      expect(relay.relay).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({ trackingNumber: 'FAST999' }),
        }),
      );
      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ status: 'delivered', trackingNumber: 'FAST999' }),
      );
    });

    it.each(['cancelled', 'failed'] as const)(
      'does NOT relay when the snapshot turns the shipment %s, but still persists the number',
      async (terminal) => {
        // Relaying here would mark the marketplace order sent and attach a
        // waybill for a parcel that will never move — plus notify the buyer.
        const s = makeShipment({ status: 'dispatched', trackingNumber: null });
        shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
        getTracking.mockResolvedValue(
          snapshot({ status: terminal, trackingNumber: 'DEAD777' }),
        );

        const result = await service.sync(CARRIER, { limit: 50 });

        expect(relay.relay).not.toHaveBeenCalled();
        expect(shipments.update).toHaveBeenCalledWith(
          s.id,
          expect.objectContaining({ status: terminal, trackingNumber: 'DEAD777' }),
        );
        expect(result.propagated).toBe(0);
      },
    );

    it('does not relay twice when the claim is already held (concurrent poll + webhook)', async () => {
      shipments.claimWaybillRelay.mockResolvedValue(false);
      const s = makeShipment({ status: 'dispatched', trackingNumber: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched', trackingNumber: 'NEW456' }));

      const result = await service.sync(CARRIER, { limit: 50 });

      expect(relay.relay).not.toHaveBeenCalled();
      // The number is DATA — it still lands even though this caller relayed nothing.
      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ trackingNumber: 'NEW456' }),
      );
      expect(result.propagated).toBe(0);
    });

    it('relays only once across two consecutive syncs (the claim is consumed)', async () => {
      const first = makeShipment({ status: 'dispatched', trackingNumber: null });
      // Second run sees the row as the first run left it: number persisted, so
      // the null→value diff no longer fires.
      const second = makeShipment({
        status: 'dispatched',
        trackingNumber: 'NEW456',
        waybillRelayedAt: new Date('2026-05-27T10:05:00.000Z'),
      });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched', trackingNumber: 'NEW456' }));

      shipments.findMany.mockResolvedValueOnce({ items: [first], total: 1 });
      await service.sync(CARRIER, { limit: 50 });
      shipments.findMany.mockResolvedValueOnce({ items: [second], total: 1 });
      await service.sync(CARRIER, { limit: 50 });

      expect(relay.relay).toHaveBeenCalledTimes(1);
    });

    it('releases the claim and withholds the number when a target REJECTS', async () => {
      relay.relay.mockResolvedValue(
        relayResult({ connectionId: SOURCE, outcome: 'rejected', detail: 'Allegro 422' }),
      );
      const s = makeShipment({ status: 'dispatched', trackingNumber: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched', trackingNumber: 'NEW456' }));

      const result = await service.sync(CARRIER, { limit: 50 });

      expect(shipments.releaseWaybillRelay).toHaveBeenCalledWith(s.id);
      // Withheld so the next poll re-detects the diff and retries.
      expect(shipments.update).not.toHaveBeenCalled();
      expect(result.propagated).toBe(0);
      // Handled inside buildPatch, not the outer try — the job stays healthy.
      expect(result.failed).toBe(0);
    });

    it('treats unsupported/adapter-unresolved as TRANSIENT — releases the claim so a retry can happen', async () => {
      // A connection mid-re-auth must not be recorded as "delivered", or the
      // waybill is lost forever the moment the number is persisted.
      relay.relay.mockResolvedValue(
        relayResult({
          connectionId: SOURCE,
          outcome: 'unsupported',
          unsupportedReason: 'adapter-unresolved',
        }),
      );
      const s = makeShipment({ status: 'dispatched', trackingNumber: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched', trackingNumber: 'NEW456' }));

      await service.sync(CARRIER, { limit: 50 });

      expect(shipments.releaseWaybillRelay).toHaveBeenCalledWith(s.id);
      expect(shipments.update).not.toHaveBeenCalled();
    });

    it('treats unsupported/no-capability as STRUCTURAL — keeps the claim and persists the number', async () => {
      // Nothing to retry: this participant will never accept a waybill. Mirrors
      // the skip the old destination-only push performed.
      relay.relay.mockResolvedValue(
        relayResult({
          connectionId: PS1,
          outcome: 'unsupported',
          unsupportedReason: 'no-capability',
        }),
      );
      const s = makeShipment({ status: 'dispatched', trackingNumber: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched', trackingNumber: 'NEW456' }));

      const result = await service.sync(CARRIER, { limit: 50 });

      expect(shipments.releaseWaybillRelay).not.toHaveBeenCalled();
      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ trackingNumber: 'NEW456' }),
      );
      expect(result.propagated).toBe(1);
    });

    it('a relay THROW releases the claim and does not discard the rest of the patch', async () => {
      // The relay reports per-target outcomes rather than throwing, but it CAN
      // throw before its loop (identifier resolution). An unhandled throw would
      // abort the patch build and lose the terminal status + carrier backfill.
      relay.relay.mockRejectedValue(new Error('identifier resolution exploded'));
      const s = makeShipment({ status: 'dispatched', trackingNumber: null, carrier: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(
        snapshot({
          status: 'delivered',
          trackingNumber: 'NEW456',
          carrier: 'inpost',
          deliveredAt: new Date('2026-05-28'),
        }),
      );

      const result = await service.sync(CARRIER, { limit: 50 });

      expect(shipments.releaseWaybillRelay).toHaveBeenCalledWith(s.id);
      const patch = shipments.update.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(patch.status).toBe('delivered');
      expect(patch.carrier).toBe('inpost');
      expect(patch.trackingNumber).toBeUndefined();
      expect(result.failed).toBe(0);
    });

    it('does not overwrite a previously-set tracking number', async () => {
      const s = makeShipment({ status: 'dispatched', trackingNumber: 'EXISTING' });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(
        snapshot({ status: 'dispatched', trackingNumber: 'WOULD_OVERWRITE' }),
      );

      await service.sync(CARRIER, { limit: 50 });

      expect(relay.relay).not.toHaveBeenCalled();
      expect(shipments.update).not.toHaveBeenCalled();
    });
  });

  describe('carrier-of-record backfill (#769)', () => {
    it('backfills carrier when shipment.carrier is null and snapshot carries one', async () => {
      const s = makeShipment({ status: 'dispatched', carrier: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched', carrier: 'inpost' }));
      await service.sync(CARRIER, { limit: 50 });
      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ carrier: 'inpost' }),
      );
    });

    it('does not overwrite a previously-set carrier (once-written-never-overwritten)', async () => {
      const s = makeShipment({ status: 'dispatched', carrier: 'inpost' });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched', carrier: 'dpd' }));
      await service.sync(CARRIER, { limit: 50 });
      expect(shipments.update).not.toHaveBeenCalled();
    });

    it('writes carrier even when the waybill relay fails (carrier is independent of the relay)', async () => {
      relay.relay.mockResolvedValue(
        relayResult({ connectionId: SOURCE, outcome: 'rejected', detail: 'source down' }),
      );
      const s = makeShipment({ status: 'dispatched', trackingNumber: null, carrier: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched', trackingNumber: 'WAYBILL', carrier: 'inpost' }));
      await service.sync(CARRIER, { limit: 50 });
      // The number is withheld so the next poll retries the relay, but the
      // carrier backfill is independent and still lands.
      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ carrier: 'inpost' }),
      );
      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.not.objectContaining({ trackingNumber: expect.any(String) }),
      );
    });

    it('writes both carrier and trackingNumber together on the happy path', async () => {
      const s = makeShipment({ status: 'dispatched', trackingNumber: null, carrier: null });
      shipments.findMany.mockResolvedValue({ items: [s], total: 1 });
      getTracking.mockResolvedValue(snapshot({ status: 'dispatched', trackingNumber: 'WAYBILL', carrier: 'inpost' }));
      await service.sync(CARRIER, { limit: 50 });
      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ trackingNumber: 'WAYBILL', carrier: 'inpost' }),
      );
    });
  });

  describe('syncOneByProviderShipmentId (#768 webhook-triggered refresh)', () => {
    it('resolves the shipment by provider id and applies the re-read patch', async () => {
      const s = makeShipment({ status: 'dispatched', trackingNumber: null });
      shipments.findByProviderShipmentId.mockResolvedValue(s);
      getTracking.mockResolvedValue(
        snapshot({ status: 'delivered', deliveredAt: new Date('2026-05-28') }),
      );

      await service.syncOneByProviderShipmentId(CARRIER, 'prov-abc');

      expect(getTracking).toHaveBeenCalledWith({ providerShipmentId: 'prov-abc' });
      expect(shipments.update).toHaveBeenCalledWith(
        s.id,
        expect.objectContaining({ status: 'delivered' }),
      );
    });

    it('is a no-op when no shipment resolves for the provider id', async () => {
      shipments.findByProviderShipmentId.mockResolvedValue(null);

      await service.syncOneByProviderShipmentId(CARRIER, 'prov-missing');

      expect(getTracking).not.toHaveBeenCalled();
      expect(shipments.update).not.toHaveBeenCalled();
    });

    it('skips (cross-connection guard) when the resolved shipment belongs to another connection', async () => {
      const s = makeShipment({ connectionId: 'conn-other' });
      shipments.findByProviderShipmentId.mockResolvedValue(s);

      await service.syncOneByProviderShipmentId(CARRIER, 'prov-abc');

      expect(getTracking).not.toHaveBeenCalled();
      expect(shipments.update).not.toHaveBeenCalled();
    });
  });
});
