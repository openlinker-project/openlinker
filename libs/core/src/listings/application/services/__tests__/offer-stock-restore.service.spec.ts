/**
 * Offer Stock Restore Service Tests
 *
 * Unit tests for OfferStockRestoreService (#1146). Mocks all ports; verifies
 * target resolution (variant → external offer id → master quantity), dispatch
 * to the OfferStockRestorer capability, and the capability-first no-op paths
 * (non-restorer adapter, unsupported/disabled OfferManager, non-capability
 * error rethrow, and the missing-record / no-variant / no-mapping skips).
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import { OfferStockRestoreService } from '../offer-stock-restore.service';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import {
  CapabilityNotEnabledException,
  CapabilityNotSupportedException,
} from '@openlinker/core/integrations';
import type { IInventoryQueryService, VariantAvailability } from '@openlinker/core/inventory';
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
  let restorer: jest.Mocked<OfferManagerPort & OfferStockRestorer>;

  beforeEach(() => {
    restorer = {
      updateOfferQuantity: jest.fn(),
      restoreStockOnCancellation: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OfferManagerPort & OfferStockRestorer>;

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
      inventoryQuery
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
    ).resolves.toBeUndefined();

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
    ).resolves.toBeUndefined();

    expect(orderRecordService.getOrderRecord).not.toHaveBeenCalled();
    expect(restorer.restoreStockOnCancellation).not.toHaveBeenCalled();
  });

  it('should no-op (not throw) when OfferManager is disabled on the connection', async () => {
    integrationsService.getCapabilityAdapter.mockRejectedValue(
      new CapabilityNotEnabledException(CONNECTION_ID, 'erli.shopapi.v1', 'OfferManager')
    );

    await expect(
      service.restoreStockForCancelledOrder(CONNECTION_ID, ORDER_ID)
    ).resolves.toBeUndefined();

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
});
