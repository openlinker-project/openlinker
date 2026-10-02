/**
 * InventorySaleDecrementHandler — spec (#3453)
 *
 * The handler composes the work and the order into core and writes the order's
 * attention verdict; the decrement rules themselves are the service's spec.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { IFulfillmentWorkQueryService } from '@openlinker/core/fulfillment';
import type {
  DecrementForWorkResult,
  IInventorySaleDecrementService,
} from '@openlinker/core/inventory';
import type { IOrderRecordService } from '@openlinker/core/orders';
import { SyncJobExecutionError, type SyncJob } from '@openlinker/core/sync';

import { InventorySaleDecrementHandler } from '../inventory-sale-decrement.handler';

describe('InventorySaleDecrementHandler (#3453)', () => {
  let handler: InventorySaleDecrementHandler;
  let saleDecrements: { decrementForWork: jest.Mock };
  let works: { findWorkById: jest.Mock };
  let orderRecords: { getOrderRecord: jest.Mock; markOmsAttention: jest.Mock };

  const job = (payload: unknown = { schemaVersion: 1, workId: 'w-1', orderId: 'ol_order_1' }) =>
    ({
      id: 'job-1',
      jobType: 'inventory.saleDecrement',
      connectionId: 'conn-allegro',
      payload,
    }) as unknown as SyncJob;

  const work = {
    id: 'w-1',
    orderId: 'ol_order_1',
    locationId: 'loc-main',
    lines: [
      {
        id: 'wl-1',
        orderLineId: 'line-1',
        productVariantId: 'ol_variant_1',
        totalQuantity: 2,
        fulfilledQuantity: 0,
        cancelledQuantity: 0,
      },
      // A line routed with the product-id fallback (no variant on the order).
      {
        id: 'wl-2',
        orderLineId: 'line-2',
        productVariantId: 'ol_product_2',
        totalQuantity: 1,
        fulfilledQuantity: 0,
        cancelledQuantity: 0,
      },
      // Fully cancelled — nothing to lower.
      {
        id: 'wl-3',
        orderLineId: 'line-3',
        productVariantId: 'ol_variant_3',
        totalQuantity: 1,
        fulfilledQuantity: 0,
        cancelledQuantity: 1,
      },
    ],
  };

  const record = {
    sourceConnectionId: 'conn-allegro',
    isCancelled: false,
    orderItems: [
      { id: 'line-1', productId: 'ol_product_1', variantId: 'ol_variant_1', quantity: 2, price: 10 },
      { id: 'line-2', productId: 'ol_product_2', quantity: 1, price: 10 },
      { id: 'line-3', productId: 'ol_product_3', variantId: 'ol_variant_3', quantity: 1, price: 10 },
    ],
  };

  const decremented = (overrides: Partial<DecrementForWorkResult> = {}): DecrementForWorkResult => ({
    lines: [],
    retryableLineIds: [],
    attention: { kind: 'none' },
    ...overrides,
  });

  beforeEach(() => {
    saleDecrements = { decrementForWork: jest.fn().mockResolvedValue(decremented()) };
    works = { findWorkById: jest.fn().mockResolvedValue(work) };
    orderRecords = {
      getOrderRecord: jest.fn().mockResolvedValue(record),
      markOmsAttention: jest.fn().mockResolvedValue(undefined),
    };
    handler = new InventorySaleDecrementHandler(
      saleDecrements as unknown as IInventorySaleDecrementService,
      works as unknown as IFulfillmentWorkQueryService,
      orderRecords as unknown as IOrderRecordService
    );
  });

  it('should hand core the work lines with each line\'s product and the order source', async () => {
    const result = await handler.execute(job());

    expect(result).toEqual({ outcome: 'ok' });
    expect(saleDecrements.decrementForWork).toHaveBeenCalledWith({
      orderId: 'ol_order_1',
      workId: 'w-1',
      orderSourceConnectionId: 'conn-allegro',
      locationId: 'loc-main',
      lines: [
        { orderLineId: 'line-1', productId: 'ol_product_1', productVariantId: 'ol_variant_1', quantity: 2 },
        // The product-id fallback is a product-level line, not a variant.
        { orderLineId: 'line-2', productId: 'ol_product_2', productVariantId: null, quantity: 1 },
      ],
    });
  });

  it('should clear the order attention state when nothing needs attention', async () => {
    await handler.execute(job());

    expect(orderRecords.markOmsAttention).toHaveBeenCalledWith('ol_order_1', 'sale-decrement', {
      kind: 'none',
    });
  });

  it('should raise the stock-decrement attention state when core reports one', async () => {
    saleDecrements.decrementForWork.mockResolvedValue(
      decremented({ attention: { kind: 'blocked', detail: '1 line(s) not lowered or in doubt' } })
    );

    const result = await handler.execute(job());

    // Terminal and visible, never retried: the row is durable.
    expect(result).toEqual({ outcome: 'ok' });
    expect(orderRecords.markOmsAttention).toHaveBeenCalledWith('ol_order_1', 'sale-decrement', {
      kind: 'blocked',
      reason: 'stock-decrement-blocked',
      detail: '1 line(s) not lowered or in doubt',
    });
  });

  it('should throw a retryable error when a line failed before the boundary', async () => {
    saleDecrements.decrementForWork.mockResolvedValue(
      decremented({
        retryableLineIds: ['line-1'],
        attention: { kind: 'blocked', detail: '1 line(s) not lowered or in doubt' },
      })
    );

    await expect(handler.execute(job())).rejects.toBeInstanceOf(SyncJobExecutionError);
    // The attention write happens BEFORE the throw, so the oversell window is visible.
    expect(orderRecords.markOmsAttention).toHaveBeenCalled();
  });

  it('should lower nothing for an order cancelled before the job ran', async () => {
    orderRecords.getOrderRecord.mockResolvedValue({ ...record, isCancelled: true });

    const result = await handler.execute(job());

    expect(result).toEqual({ outcome: 'ok' });
    expect(saleDecrements.decrementForWork).not.toHaveBeenCalled();
  });

  it('should terminate when the work does not exist', async () => {
    works.findWorkById.mockResolvedValue(null);

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'business_failure' });
    expect(saleDecrements.decrementForWork).not.toHaveBeenCalled();
  });

  it('should retry when the order record is not readable yet', async () => {
    orderRecords.getOrderRecord.mockResolvedValue(null);

    await expect(handler.execute(job())).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should terminate on a malformed payload', async () => {
    await expect(handler.execute(job({ workId: '' }))).resolves.toEqual({
      outcome: 'business_failure',
    });
  });

  // The work row is the authority on its order, never the payload.
  it('should read the order the work belongs to, not the one the payload names', async () => {
    await handler.execute(job({ schemaVersion: 1, workId: 'w-1', orderId: 'ol_order_stale' }));

    expect(orderRecords.getOrderRecord).toHaveBeenCalledWith('ol_order_1');
  });

  it('should not fail the job when the attention write fails', async () => {
    orderRecords.markOmsAttention.mockRejectedValue(new Error('db blip'));

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });
  });
});
