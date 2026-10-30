/**
 * Offer Stock Restore Service Tests
 *
 * Unit tests for OfferStockRestoreService (#1146, #2348). Mocks all ports;
 * verifies target resolution (variant → external offer id → ATP), the write
 * through the ordered quantity seam (#2617) for an OfferStockRestorer
 * connection, the no-op paths (non-restorer adapter,
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
  IInventorySaleReversalService,
  IReservationService,
  VariantAvailability,
  IInventorySyncService,
} from '@openlinker/core/inventory';
import type { IShipmentQueryService } from '@openlinker/core/shipping';
import {
  OfferStockRestoreReleaseIncompleteError,
  OfferStockRestoreReversalIncompleteError,
  OfferStockRestoreWriteIncompleteError,
} from '@openlinker/core/listings';
import type {
  UpdateOfferQuantitiesBatchCommand,
  UpdateOfferQuantityCommand,
} from '@openlinker/core/listings';
import { ContendedWriteError } from '@openlinker/core/sync';
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
const STAMP = new Date('2026-10-26T10:00:00.000Z');
const OBSERVED = STAMP.toISOString();

function mapping(internalId: string, externalId: string): OfferMappingListItem {
  return { internalId, externalId } as unknown as OfferMappingListItem;
}

function availability(rows: Array<[string, number]>): VariantAvailability[] {
  return rows.map(([productVariantId, totalAvailable]) => ({
    productVariantId,
    totalAvailable,
    locationCount: 1, positionCount: 1,
    stockUpdatedAt: STAMP,
    // Wave-1b: empty ledger, so ATP mirrors master stock (#2323).
    availableToPromise: totalAvailable,
  }));
}

/** The command the restore hands the ordered write seam for one offer. */
function item(offerId: string, quantity: number): UpdateOfferQuantityCommand {
  return {
    offerId,
    quantity,
    idempotencyKey: `stock-restore:${ORDER_ID}:${offerId}:${quantity}:${OBSERVED}`,
    observedAt: OBSERVED,
  };
}

describe('OfferStockRestoreService', () => {
  let service: OfferStockRestoreService;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let orderRecordService: jest.Mocked<IOrderRecordService>;
  let offerMappings: jest.Mocked<OfferMappingRepositoryPort>;
  let inventoryQuery: jest.Mocked<IInventoryQueryService>;
  let reservations: jest.Mocked<IReservationService>;
  let shipments: jest.Mocked<IShipmentQueryService>;
  let saleReversal: jest.Mocked<IInventorySaleReversalService>;
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
  let inventorySync: jest.Mocked<IInventorySyncService>;

  beforeEach(() => {
    callOrder = [];
    restorer = {
      updateOfferQuantity: jest.fn(),
      restoreStockOnCancellation: jest.fn(),
    } as unknown as jest.Mocked<OfferManagerPort & OfferStockRestorer>;

    // The ordered write seam (#2617). Default: every offer written.
    inventorySync = {
      updateOfferQuantity: jest.fn(),
      updateOfferQuantities: jest
        .fn()
        .mockImplementation((_connectionId: string, cmd: UpdateOfferQuantitiesBatchCommand) => {
          callOrder.push('restore');
          return Promise.resolve({ succeeded: cmd.items.map((i) => i.offerId), failed: [] });
        }),
    } as unknown as jest.Mocked<IInventorySyncService>;

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

    // #3479 — no order carries an applied `order_sale` decrement by default;
    // tests that care about the reversal set this explicitly.
    saleReversal = {
      reverseForOrder: jest.fn().mockResolvedValue({ lines: [] }),
    } as unknown as jest.Mocked<IInventorySaleReversalService>;

    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(restorer),
      getAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

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
      inventorySync,
      reservations,
      shipments,
      saleReversal
    );
  });

  function orderRecord(items: Array<{ variantId?: string }>): OrderRecord {
    return { orderSnapshot: { items } } as unknown as OrderRecord;
  }

  it('should write each restore through the ordered quantity seam, not the restorer', async () => {
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

    expect(inventorySync.updateOfferQuantities).toHaveBeenCalledTimes(1);
    // The capability only declares participation; writing through it directly
    // would skip the #2617 freshness guard.
    expect(restorer.restoreStockOnCancellation).not.toHaveBeenCalled();
    expect(inventorySync.updateOfferQuantities).toHaveBeenCalledWith(CONNECTION_ID, {
      items: [
        item(OFFER_A, 5),
        item(OFFER_B, 12),
      ],
    });
  });

  it('should restore every offer mapped to a relisted variant, not only the first (E2E-26)', async () => {
    // A relisted variant keeps its old ended offer beside the live one; the
    // page lists the ended one first, which is the order seen live.
    const ENDED_OFFER = 'offer-ended-1';
    orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{ variantId: VARIANT_A }]));
    offerMappings.findMappingPage.mockResolvedValue({
      items: [mapping(VARIANT_A, ENDED_OFFER), mapping(VARIANT_A, OFFER_A)],
      total: 2,
    });
    inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue(availability([[VARIANT_A, 20]]));

    await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

    expect(inventorySync.updateOfferQuantities).toHaveBeenCalledWith(CONNECTION_ID, {
      items: [
        item(ENDED_OFFER, 20),
        item(OFFER_A, 20),
      ],
    });
  });

  it('should restore a known zero (master authoritative including 0)', async () => {
    orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{ variantId: VARIANT_A }]));
    offerMappings.findMappingPage.mockResolvedValue({ items: [mapping(VARIANT_A, OFFER_A)], total: 1 });
    inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue(availability([[VARIANT_A, 0]]));

    await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

    expect(inventorySync.updateOfferQuantities).toHaveBeenCalledWith(CONNECTION_ID, {
      items: [
        item(OFFER_A, 0),
      ],
    });
  });

  it('should omit — never zero — a variant whose availability is unknown (#2323)', async () => {
    orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{ variantId: VARIANT_A }]));
    offerMappings.findMappingPage.mockResolvedValue({ items: [mapping(VARIANT_A, OFFER_A)], total: 1 });
    inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
      {
        productVariantId: VARIANT_A,
        totalAvailable: 12,
        locationCount: 1, positionCount: 1,
        availableToPromise: null,
      },
    ]);

    await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

    // Writing 0 here would DEACTIVATE a live offer (#1689's pause primitive) on
    // the strength of a failed read; writing `totalAvailable` would restore
    // stock that is already promised elsewhere. Doing nothing is the only
    // answer that asserts nothing false.
    expect(inventorySync.updateOfferQuantities).not.toHaveBeenCalled();
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
    expect(inventorySync.updateOfferQuantities).not.toHaveBeenCalled();
  });

  it('should no-op (not throw) when OfferManager is unsupported by the adapter', async () => {
    integrationsService.getCapabilityAdapter.mockRejectedValue(
      new CapabilityNotSupportedException('erli.shopapi.v1', 'OfferManager')
    );

    await expect(
      service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID)
    ).resolves.toMatchObject({ outcome: 'skipped-no-restorer' });

    expect(orderRecordService.getOrderRecord).not.toHaveBeenCalled();
    expect(inventorySync.updateOfferQuantities).not.toHaveBeenCalled();
  });

  it('should no-op (not throw) when OfferManager is disabled on the connection', async () => {
    integrationsService.getCapabilityAdapter.mockRejectedValue(
      new CapabilityNotEnabledException(CONNECTION_ID, 'erli.shopapi.v1', 'OfferManager')
    );

    await expect(
      service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID)
    ).resolves.toMatchObject({ outcome: 'skipped-no-restorer' });

    expect(orderRecordService.getOrderRecord).not.toHaveBeenCalled();
    expect(inventorySync.updateOfferQuantities).not.toHaveBeenCalled();
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
    expect(inventorySync.updateOfferQuantities).not.toHaveBeenCalled();
  });

  it('should no-op when the order has no resolved variants', async () => {
    orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{}]));

    await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

    expect(offerMappings.findMappingPage).not.toHaveBeenCalled();
    expect(inventorySync.updateOfferQuantities).not.toHaveBeenCalled();
  });

  it('should no-op when none of the order variants have an offer mapping', async () => {
    orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{ variantId: VARIANT_A }]));
    offerMappings.findMappingPage.mockResolvedValue({ items: [], total: 0 });

    await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

    expect(inventoryQuery.getAvailabilityByVariantIds).not.toHaveBeenCalled();
    expect(inventorySync.updateOfferQuantities).not.toHaveBeenCalled();
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

      expect(inventorySync.updateOfferQuantities).not.toHaveBeenCalled();
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

      expect(inventorySync.updateOfferQuantities).not.toHaveBeenCalled();
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

      expect(inventorySync.updateOfferQuantities).toHaveBeenCalledWith(CONNECTION_ID, {
      items: [
        item(OFFER_A, 7),
      ],
    });
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

      expect(inventorySync.updateOfferQuantities).not.toHaveBeenCalled();
      expect(result.outcome).toBe('skipped-no-targets');
    });
  });

  describe('sale-decrement reversal (#3479)', () => {
    function readyToRestore(): void {
      orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{ variantId: VARIANT_A }]));
      offerMappings.findMappingPage.mockResolvedValue({
        items: [mapping(VARIANT_A, OFFER_A)],
        total: 1,
      });
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue(availability([[VARIANT_A, 7]]));
    }

    it('should raise the master back BEFORE reading availability to republish', async () => {
      readyToRestore();
      const order: string[] = [];
      saleReversal.reverseForOrder.mockImplementation(() => {
        order.push('reverse');
        return Promise.resolve({ lines: [] });
      });
      inventoryQuery.getAvailabilityByVariantIds.mockImplementation(() => {
        order.push('availability');
        return Promise.resolve(availability([[VARIANT_A, 7]]));
      });

      await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

      expect(saleReversal.reverseForOrder).toHaveBeenCalledWith(ORDER_ID);
      expect(order).toEqual(['reverse', 'availability']);
    });

    it('should not reverse an order whose goods already shipped', async () => {
      readyToRestore();
      shipments.hasConsumedReservations.mockResolvedValue(true);

      await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

      expect(saleReversal.reverseForOrder).not.toHaveBeenCalled();
    });

    it('should still restore the offer when the reversal line is in doubt (no retry can change it)', async () => {
      readyToRestore();
      saleReversal.reverseForOrder.mockResolvedValue({
        lines: [
          {
            orderLineId: 'line-1',
            status: 'in_doubt',
            reason: 'master-error',
            ownerConnectionId: 'conn-shop',
            attempted: true,
          },
        ],
      });

      const result = await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

      expect(result.outcome).toBe('restored');
      expect(inventorySync.updateOfferQuantities).toHaveBeenCalled();
    });

    it('should fail the job when the reversal throws, so the retry ladder re-runs it', async () => {
      readyToRestore();
      saleReversal.reverseForOrder.mockRejectedValue(new Error('reversal blew up'));

      await expect(service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID)).rejects.toThrow(
        OfferStockRestoreReversalIncompleteError,
      );
      expect(inventorySync.updateOfferQuantities).not.toHaveBeenCalled();
    });

    it('should fail the job when a reversal line is retryable', async () => {
      readyToRestore();
      saleReversal.reverseForOrder.mockResolvedValue({
        lines: [
          {
            orderLineId: 'line-1',
            status: 'retryable',
            reason: 'adapter-unresolved',
            ownerConnectionId: 'conn-shop',
            attempted: false,
          },
        ],
      });

      await expect(service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID)).rejects.toThrow(
        OfferStockRestoreReversalIncompleteError,
      );
    });
  });

  it('should hand the seam the raw ATP, so the Controls are applied once there (#2610)', async () => {
    // The seam applies the reserve and the zero threshold; buffering here too
    // would hold the reserve back twice.
    orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{ variantId: VARIANT_A }]));
    offerMappings.findMappingPage.mockResolvedValue({
      items: [mapping(VARIANT_A, OFFER_A)],
      total: 1,
    });
    inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue(availability([[VARIANT_A, 5]]));

    await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

    expect(inventorySync.updateOfferQuantities).toHaveBeenCalledWith(CONNECTION_ID, {
      items: [item(OFFER_A, 5)],
    });
  });

  describe('write ordering and retries (#2617, #3814 review)', () => {
    function readyToRestore(): void {
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
    }

    it('should quote the stock observation so an older restore cannot land after a newer propagation', async () => {
      readyToRestore();

      await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

      const [, cmd] = inventorySync.updateOfferQuantities.mock.calls[0];
      expect(cmd.items.map((i) => i.observedAt)).toEqual([OBSERVED, OBSERVED]);
    });

    it('should write a variant with no observed positions unguarded, keyed as unobserved', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{ variantId: VARIANT_A }]));
      offerMappings.findMappingPage.mockResolvedValue({
        items: [mapping(VARIANT_A, OFFER_A)],
        total: 1,
      });
      inventoryQuery.getAvailabilityByVariantIds.mockResolvedValue([
        { productVariantId: VARIANT_A, totalAvailable: 0, locationCount: 0, positionCount: 0, availableToPromise: 0 },
      ]);

      await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

      expect(inventorySync.updateOfferQuantities).toHaveBeenCalledWith(CONNECTION_ID, {
        items: [
          {
            offerId: OFFER_A,
            quantity: 0,
            idempotencyKey: `stock-restore:${ORDER_ID}:${OFFER_A}:0:unobserved`,
          },
        ],
      });
    });

    it('should key a retry after stock moved as a different command', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue(orderRecord([{ variantId: VARIANT_A }]));
      offerMappings.findMappingPage.mockResolvedValue({
        items: [mapping(VARIANT_A, OFFER_A)],
        total: 1,
      });
      inventoryQuery.getAvailabilityByVariantIds
        .mockResolvedValueOnce(availability([[VARIANT_A, 5]]))
        .mockResolvedValueOnce([
          {
            productVariantId: VARIANT_A,
            totalAvailable: 4,
            locationCount: 1, positionCount: 1,
            stockUpdatedAt: new Date('2026-10-26T11:00:00.000Z'),
            availableToPromise: 4,
          },
        ]);

      await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);
      await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

      const keys = inventorySync.updateOfferQuantities.mock.calls.map(
        ([, cmd]) => cmd.items[0].idempotencyKey
      );
      expect(keys[0]).not.toEqual(keys[1]);
    });

    it('should try every offer and then fail the job when one was not written', async () => {
      readyToRestore();
      inventorySync.updateOfferQuantities.mockResolvedValue({
        succeeded: [OFFER_A],
        failed: [{ offerId: OFFER_B, errorCode: 'rejected', message: 'nope' }],
      });

      await expect(
        service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID)
      ).rejects.toBeInstanceOf(OfferStockRestoreWriteIncompleteError);

      const [, cmd] = inventorySync.updateOfferQuantities.mock.calls[0];
      expect(cmd.items.map((i) => i.offerId)).toEqual([OFFER_A, OFFER_B]);
    });

    it('should fail the job when the publish Controls could not be resolved', async () => {
      readyToRestore();
      inventorySync.updateOfferQuantities.mockResolvedValue({
        succeeded: [],
        failed: [
          { offerId: OFFER_A, errorCode: 'availability_unknown' },
          { offerId: OFFER_B, errorCode: 'availability_unknown' },
        ],
      });

      await expect(
        service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID)
      ).rejects.toBeInstanceOf(OfferStockRestoreWriteIncompleteError);
    });

    it('should defer, not fail, when every failure is a contended write lock', async () => {
      readyToRestore();
      inventorySync.updateOfferQuantities.mockResolvedValue({
        succeeded: [OFFER_A],
        failed: [{ offerId: OFFER_B, errorCode: 'write_contended' }],
      });

      await expect(
        service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID)
      ).rejects.toBeInstanceOf(ContendedWriteError);
    });

    it('should report a superseded offer as restored, since a newer quantity is live', async () => {
      // The seam reports a write refused by a newer mark as succeeded.
      readyToRestore();

      const result = await service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID);

      expect(result.offersRestored).toBe(2);
    });
  });
});
