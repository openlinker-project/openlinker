/**
 * Offer Stock Restore Service Tests
 *
 * Unit tests for OfferStockRestoreService (#1146, #2348). Mocks all ports;
 * verifies target resolution (variant → external offer id → ATP), dispatch to
 * the OfferStockRestorer capability, the no-op paths (non-restorer adapter,
 * unsupported/disabled OfferManager, non-capability error rethrow, and the
 * missing-record / no-variant / no-mapping skips) — and, for #2348, the ordering
 * contract: release strictly precedes restore, runs even when nothing will be
 * restored, and a shipped order does not restore at all.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import { OfferStockRestoreService } from '../offer-stock-restore.service';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import {
  CapabilityNotEnabledException,
  CapabilityNotSupportedException,
} from '@openlinker/core/integrations';
import type {
  CloseForOrderResult,
  IInventoryQueryService,
  IReservationService,
  VariantAvailability,
  IAvailabilityService,
} from '@openlinker/core/inventory';
import type { IShipmentQueryService } from '@openlinker/core/shipping';
import { OfferStockRestoreReleaseIncompleteError } from '@openlinker/core/listings';
import type { IOrderRecordService } from '@openlinker/core/orders';
import type {
  OfferManagerPort,
  OfferMappingRepositoryPort,
  OfferStockRestorer,
} from '@openlinker/core/listings';
import type { OfferMappingListItem } from '@openlinker/core/listings';
import type { OrderRecord } from '@openlinker/core/orders';

const CONNECTION_ID = 'conn-1';
const ORDER_ID = 'ol_order_abc';
const VARIANT_A = 'ol_variant_a';
const VARIANT_B = 'ol_variant_b';
const OFFER_A = 'erli-offer-a';
const OFFER_B = 'erli-offer-b';

function mapping(internalId: string, externalId: string): OfferMappingListItem {
  return { internalId, externalId } as unknown as OfferMappingListItem;
}

function availability(rows: Array<[string, number]>): VariantAvailability[] {
  return rows.map(([productVariantId, totalAvailable]) => ({
    productVariantId,
    totalAvailable,
    locationCount: 1,
    // Wave-1b: empty ledger, so ATP mirrors master stock (#2323).
    availableToPromise: totalAvailable,
  }));
}

describe('OfferStockRestoreService', () => {
  let service: OfferStockRestoreService;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let orderRecordService: jest.Mocked<IOrderRecordService>;
  let offerMappings: jest.Mocked<OfferMappingRepositoryPort>;
  let inventoryQuery: jest.Mocked<IInventoryQueryService>;
  let reservations: jest.Mocked<IReservationService>;
  let shipments: jest.Mocked<IShipmentQueryService>;
  let restorer: jest.Mocked<OfferManagerPort & OfferStockRestorer>;
  /**
   * One shared recorder across the release and the restore. The types already
   * make an inverted order fail to compile (`publishRestoredAtp` takes the
   * release's own result); this is the second half of the guarantee — a refactor
   * that kept the types but inverted the EFFECTS still fails here.
   */
  let callOrder: string[];

  const closeResult = (over: Partial<CloseForOrderResult> = {}): CloseForOrderResult => ({
    closed: 1,
    alreadyTerminal: 0,
    failed: 0,
    ...over,
  });
  let availabilityService: jest.Mocked<IAvailabilityService>;

  beforeEach(() => {
    callOrder = [];
    restorer = {
      updateOfferQuantity: jest.fn(),
      restoreStockOnCancellation: jest.fn().mockImplementation(() => {
        callOrder.push('restore');
        return Promise.resolve(undefined);
      }),
    } as unknown as jest.Mocked<OfferManagerPort & OfferStockRestorer>;

    reservations = {
      reserveForOrder: jest.fn(),
      closeForOrder: jest.fn().mockImplementation(() => {
        callOrder.push('release');
        return Promise.resolve(closeResult());
      }),
    } as unknown as jest.Mocked<IReservationService>;

    shipments = {
      list: jest.fn(),
      getById: jest.fn(),
      getActiveByOrderId: jest.fn(),
      hasConsumedReservations: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<IShipmentQueryService>;

    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(restorer),
      getAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    // #2610 via #2323 — the restore asks the availability seam for the
    // connection's publish Controls rather than reading the buffer helpers.
    // Default: pass-through (no reserve, no threshold).
    availabilityService = {
      applyPublishControlsBatch: jest.fn((input: { quantities: readonly number[] }) =>
        Promise.resolve(
          input.quantities.map((quantity) => ({ quantity, provenance: 'computed' as const }))
        )
      ),
      applyPublishControls: jest.fn(),
      getPromisableQuantities: jest.fn(),
      getAppliedReserve: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<IAvailabilityService>;

    orderRecordService = {
      getOrderRecord: jest.fn(),
      findByIds: jest.fn(),
    } as unknown as jest.Mocked<IOrderRecordService>;

    offerMappings = {
      findById: jest.fn(),
      findMany: jest.fn(),
      findMappingPage: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      countByConnectionAndVariants: jest.fn(),
    } as unknown as jest.Mocked<OfferMappingRepositoryPort>;

    inventoryQuery = {
      listInventoryItems: jest.fn(),
      getAvailabilityByVariantIds: jest.fn(),
      getProductStockAggregates: jest.fn(),
    } as unknown as jest.Mocked<IInventoryQueryService>;

    service = new OfferStockRestoreService(
      integrationsService,
      orderRecordService,
      offerMappings,
      inventoryQuery,
      availabilityService,
      reservations,
      shipments
    );
  });

  function orderRecord(items: Array<{ variantId?: string }>): OrderRecord {
    return { orderSnapshot: { items } } as unknown as OrderRecord;
  }

  it('should build correct targets and call restoreStockOnCancellation', async () => {
    orderRecordService.getOrderRecord.mockResolvedValue(
      orderRecord([{ variantId: VARIANT_A }, { variantId: VARIANT_B }])
    );
    offerMappings.findMappingPage
      .mockResolvedValueOnce({ items: [mapping(VARIANT_A, OFFER_A)], total: 1 })
      .mockResolvedValueOnce({ items: [mapping(VARIANT_B, OFFER_B)], total: 1 });
    inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue(
      availability([
        [VARIANT_A, 5],
        [VARIANT_B, 12],
      ])
    );

    await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

    expect(restorer.restoreStockOnCancellation).toHaveBeenCalledTimes(1);
    expect(restorer.restoreStockOnCancellation).toHaveBeenCalledWith([
      { externalOfferId: OFFER_A, quantity: 5 },
      { externalOfferId: OFFER_B, quantity: 12 },
    ]);
  });

  it('should restore a known zero (master authoritative including 0)', async () => {
    orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{ variantId: VARIANT_A }]));
    offerMappings.findMappingPage.mockResolvedValue({ items: [mapping(VARIANT_A, OFFER_A)], total: 1 });
    inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue(availability([[VARIANT_A, 0]]));

    await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

    expect(restorer.restoreStockOnCancellation).toHaveBeenCalledWith([
      { externalOfferId: OFFER_A, quantity: 0 },
    ]);
  });

  it('should omit — never zero — a variant whose availability is unknown (#2323)', async () => {
    orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{ variantId: VARIANT_A }]));
    offerMappings.findMappingPage.mockResolvedValue({ items: [mapping(VARIANT_A, OFFER_A)], total: 1 });
    inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
      {
        productVariantId: VARIANT_A,
        totalAvailable: 12,
        locationCount: 1,
        availableToPromise: null,
      },
    ]);

    await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

    // Writing 0 here would DEACTIVATE a live offer (#1689's pause primitive) on
    // the strength of a failed read; writing `totalAvailable` would restore
    // stock that is already promised elsewhere. Doing nothing is the only
    // answer that asserts nothing false.
    expect(restorer.restoreStockOnCancellation).not.toHaveBeenCalled();
  });

  /**
   * ADR-028 ordering, pinned (#2323).
   *
   * The availability read must happen AFTER the cancelled order's own
   * reservations are released, or those holds are still counted and the
   * restore under-writes by exactly the quantity being cancelled. Nothing in
   * this service releases them today (the empty Wave-1b ledger makes it moot),
   * so this pins the ordering that has to hold once it does not: the read
   * happens after the order record is resolved, not before it.
   */
  it('should read availability only after resolving the cancelled order (ADR-028 ordering)', async () => {
    const order: string[] = [];
    orderRecordService.getOrderRecord.mockImplementation(() => {
      order.push('order');
      return Promise.resolve(orderRecord([{ variantId: VARIANT_A }]));
    });
    offerMappings.findMappingPage.mockResolvedValue({ items: [mapping(VARIANT_A, OFFER_A)], total: 1 });
    inventoryQuery.getAvailabilityByVariantIds.mockImplementation(() => {
      order.push('availability');
      return Promise.resolve(availability([[VARIANT_A, 5]]));
    });

    await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

    expect(order).toEqual(['order', 'availability']);
  });

  it('should no-op (no order/mapping reads) when the adapter does not support OfferStockRestorer', async () => {
    // Capability is resolved first; a non-restorer adapter (e.g. Allegro, which
    // restores its own stock) short-circuits before any DB work.
    integrationsService.getCapabilityAdapter.mockResolvedValue({
      updateOfferQuantity: jest.fn(),
    } as unknown as OfferManagerPort);

    await expect(
      service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID)
    ).resolves.toMatchObject({ outcome: 'skipped-no-restorer' });

    expect(orderRecordService.getOrderRecord).not.toHaveBeenCalled();
    expect(offerMappings.findMappingPage).not.toHaveBeenCalled();
    expect(restorer.restoreStockOnCancellation).not.toHaveBeenCalled();
  });

  it('should no-op (not throw) when OfferManager is unsupported by the adapter', async () => {
    integrationsService.getCapabilityAdapter.mockRejectedValue(
      new CapabilityNotSupportedException('erli.shopapi.v1', 'OfferManager')
    );

    await expect(
      service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID)
    ).resolves.toMatchObject({ outcome: 'skipped-no-restorer' });

    expect(orderRecordService.getOrderRecord).not.toHaveBeenCalled();
    expect(restorer.restoreStockOnCancellation).not.toHaveBeenCalled();
  });

  it('should no-op (not throw) when OfferManager is disabled on the connection', async () => {
    integrationsService.getCapabilityAdapter.mockRejectedValue(
      new CapabilityNotEnabledException(CONNECTION_ID, 'erli.shopapi.v1', 'OfferManager')
    );

    await expect(
      service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID)
    ).resolves.toMatchObject({ outcome: 'skipped-no-restorer' });

    expect(orderRecordService.getOrderRecord).not.toHaveBeenCalled();
    expect(restorer.restoreStockOnCancellation).not.toHaveBeenCalled();
  });

  it('should rethrow non-capability errors from adapter resolution', async () => {
    integrationsService.getCapabilityAdapter.mockRejectedValue(new Error('connection lookup failed'));

    await expect(
      service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID)
    ).rejects.toThrow('connection lookup failed');
  });

  it('should no-op when the order record is not found', async () => {
    orderRecordService.getOrderRecord.mockResolvedValue(null);

    await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

    expect(offerMappings.findMappingPage).not.toHaveBeenCalled();
    expect(restorer.restoreStockOnCancellation).not.toHaveBeenCalled();
  });

  it('should no-op when the order has no resolved variants', async () => {
    orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{}]));

    await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

    expect(offerMappings.findMappingPage).not.toHaveBeenCalled();
    expect(restorer.restoreStockOnCancellation).not.toHaveBeenCalled();
  });

  it('should no-op when none of the order variants have an offer mapping', async () => {
    orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{ variantId: VARIANT_A }]));
    offerMappings.findMappingPage.mockResolvedValue({ items: [], total: 0 });

    await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

    expect(inventoryQuery.getAvailabilityByVariantIds).not.toHaveBeenCalled();
    expect(restorer.restoreStockOnCancellation).not.toHaveBeenCalled();
  });

  describe('ordering: release strictly precedes restore (#2348)', () => {
    function readyToRestore(): void {
      orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{ variantId: VARIANT_A }]));
      offerMappings.findMappingPage.mockResolvedValue({
        items: [mapping(VARIANT_A, OFFER_A)],
        total: 1,
      });
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue(availability([[VARIANT_A, 7]]));
    }

    it('should release the order holds BEFORE publishing the restore', async () => {
      // AC-2. Inverted, the ATP read is still net of the very hold being
      // cancelled, so the offer is republished SHORT by exactly the cancelled
      // quantity — silently, and forever.
      readyToRestore();

      const result = await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

      expect(callOrder).toEqual(['release', 'restore']);
      expect(reservations.closeForOrder).toHaveBeenCalledWith({
        orderRecordId: ORDER_ID,
        terminalStatus: 'released',
      });
      expect(result).toEqual({
        released: 1,
        alreadyTerminal: 0,
        offersRestored: 1,
        outcome: 'restored',
      });
    });

    it('should release even when the connection exposes no OfferStockRestorer', async () => {
      // The release sits ABOVE the capability short-circuit on purpose: most
      // connections restore their own stock (Allegro), and a release placed
      // behind that guard would leak this order's hold on every one of them.
      integrationsService.getCapabilityAdapter.mockResolvedValue(
        { updateOfferQuantity: jest.fn() } as unknown as OfferManagerPort
      );

      const result = await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

      expect(reservations.closeForOrder).toHaveBeenCalledTimes(1);
      expect(result.outcome).toBe('skipped-no-restorer');
      expect(result.released).toBe(1);
    });

    it('should not restore an order whose goods already shipped', async () => {
      // AC-3. The durable `Shipment.reservationConsumedAt` claim, never an
      // inference from reservation status. The release still runs — it is a
      // guarded no-op on already-consumed rows — but nothing is republished.
      readyToRestore();
      shipments.hasConsumedReservations.mockResolvedValue(true);

      const result = await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

      expect(restorer.restoreStockOnCancellation).not.toHaveBeenCalled();
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(result.outcome).toBe('skipped-consumed');
    });

    it('should throw when the release could not close every hold', async () => {
      // Not a degradation. Live holds still stand, so publishing would
      // under-restore; and a handler returning `ok` is never retried, with no
      // reconcile sweep for the stock restore to heal it.
      readyToRestore();
      reservations.closeForOrder.mockResolvedValue(closeResult({ closed: 1, failed: 1 }));

      await expect(
        service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID)
      ).rejects.toBeInstanceOf(OfferStockRestoreReleaseIncompleteError);

      expect(restorer.restoreStockOnCancellation).not.toHaveBeenCalled();
    });

    it('should report a release that closed nothing without failing', async () => {
      // An order holds nothing when reservations are disabled, when no line
      // resolved to a live position, or when a peer already closed it. Common,
      // and not an error.
      readyToRestore();
      reservations.closeForOrder.mockResolvedValue(closeResult({ closed: 0, alreadyTerminal: 2 }));

      const result = await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

      expect(result).toEqual({
        released: 0,
        alreadyTerminal: 2,
        offersRestored: 1,
        outcome: 'restored',
      });
    });

    it('should OMIT a variant whose availability is unknown, never publish 0', async () => {
      // `0` is the primitive #1689 uses to PAUSE an offer, so writing it on the
      // strength of a failed read would deactivate a live listing.
      orderRecordService.getOrderRecord.mockResolvedValue(
        orderRecord([{ variantId: VARIANT_A }, { variantId: VARIANT_B }])
      );
      offerMappings.findMappingPage
        .mockResolvedValueOnce({ items: [mapping(VARIANT_A, OFFER_A)], total: 1 })
        .mockResolvedValueOnce({ items: [mapping(VARIANT_B, OFFER_B)], total: 1 });
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue(availability([[VARIANT_A, 7]]));

      const result = await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

      expect(restorer.restoreStockOnCancellation).toHaveBeenCalledWith([
        { externalOfferId: OFFER_A, quantity: 7 },
      ]);
      expect(result.offersRestored).toBe(1);
    });

    it('should report skipped-no-targets when availability is unknown for every variant', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{ variantId: VARIANT_A }]));
      offerMappings.findMappingPage.mockResolvedValue({
        items: [mapping(VARIANT_A, OFFER_A)],
        total: 1,
      });
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([]);

      const result = await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

      expect(restorer.restoreStockOnCancellation).not.toHaveBeenCalled();
      expect(result.outcome).toBe('skipped-no-targets');
    });
  });

  it('should hold back the connection stock safety buffer when restoring (#2610)', async () => {
    // The seam applies the Controls; a reserve of 2 over a master 5 publishes 3.
    availabilityService.applyPublishControlsBatch.mockResolvedValue([
      { quantity: 3, provenance: 'computed' },
    ]);
    orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{ variantId: VARIANT_A }]));
    offerMappings.findMappingPage.mockResolvedValue({
      items: [mapping(VARIANT_A, OFFER_A)],
      total: 1,
    });
    inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue(availability([[VARIANT_A, 5]]));

    await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

    expect(restorer.restoreStockOnCancellation).toHaveBeenCalledWith([
      { externalOfferId: OFFER_A, quantity: 3 },
    ]);
  });

  it('should publish 0 when the restored quantity is below the zero threshold (#2610)', async () => {
    // A threshold of 4 over a master 3 publishes 0 — the seam's arithmetic.
    availabilityService.applyPublishControlsBatch.mockResolvedValue([
      { quantity: 0, provenance: 'computed' },
    ]);
    orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{ variantId: VARIANT_A }]));
    offerMappings.findMappingPage.mockResolvedValue({
      items: [mapping(VARIANT_A, OFFER_A)],
      total: 1,
    });
    inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue(availability([[VARIANT_A, 3]]));

    await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

    expect(restorer.restoreStockOnCancellation).toHaveBeenCalledWith([
      { externalOfferId: OFFER_A, quantity: 0 },
    ]);
  });
});
