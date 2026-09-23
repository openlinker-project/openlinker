/**
 * Fulfillment Work Auto-Dispatch Handler tests (#3340, closing #2729)
 *
 * The pure derivation (weight, recipient, delivery intent) has its own spec
 * in `libs/core/src/shipping/domain/auto-dispatch.spec.ts`. What is asserted
 * here is the handler's OWN job: the config gate, the "buy at most once"
 * guard, the assembly of a `ShipmentDispatchInput` from a work + an order,
 * and the ADR-007 outcome split across every named refusal.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { FulfillmentWorkNotFoundError } from '@openlinker/core/fulfillment';
import {
  OrderNotDispatchableHeldException,
  OrderNotDispatchablePaymentStatusException,
  ShippingProviderRejectionException,
  UndispatchableResolutionException,
} from '@openlinker/core/shipping';

import { FulfillmentWorkAutoDispatchHandler } from '../fulfillment-work-auto-dispatch.handler';

describe('FulfillmentWorkAutoDispatchHandler', () => {
  let handler: FulfillmentWorkAutoDispatchHandler;
  let integrations: { getAdapter: jest.Mock };
  let worklist: { get: jest.Mock };
  let shipmentQuery: { findByFulfillmentWorkIds: jest.Mock };
  let shipmentDispatch: { dispatch: jest.Mock };
  let orderRecords: { getOrderRecord: jest.Mock };
  let products: { getVariantsByIds: jest.Mock };

  const readyRecord = (overrides: Record<string, unknown> = {}) => ({
    internalOrderId: 'ol_order_1',
    recordStatus: 'ready',
    sourceConnectionId: 'src-conn-1',
    sourceDeliveryMethodId: 'method-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    orderSnapshot: {
      id: 'ol_order_1',
      customerEmail: 'buyer@example.com',
      shipping: { methodId: 'method-1', methodName: 'DPD Courier' },
      shippingAddress: {
        firstName: 'Anna',
        lastName: 'Kowalska',
        address1: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
        phone: '+48123456789',
      },
      billingAddress: {
        firstName: 'Anna',
        lastName: 'Kowalska',
        address1: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
      },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...overrides,
    },
  });

  const workView = (overrides: Record<string, unknown> = {}) => ({
    id: 'w1',
    orderId: 'ol_order_1',
    assignedConnectionId: 'conn-1',
    lines: [{ id: 'l1', orderLineId: 'oli-1', productVariantId: 'v1', totalQuantity: 2, cancelledQuantity: 0 }],
    ...overrides,
  });

  const job = (payload: Record<string, unknown>): SyncJob =>
    ({
      id: 'job-1',
      jobType: 'fulfillment.work.autoDispatch' as unknown as SyncJob['jobType'],
      connectionId: 'conn-1',
      payload,
      idempotencyKey: 'k',
      status: 'queued',
      attempts: 0,
      maxAttempts: 10,
      nextRunAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as unknown as SyncJob;

  const validPayload = { workId: 'w1', orderId: 'ol_order_1' };

  beforeEach(() => {
    integrations = {
      getAdapter: jest.fn().mockResolvedValue({
        connection: { config: { autoDispatch: { enabled: true } } },
        metadata: {},
      }),
    };
    worklist = { get: jest.fn().mockResolvedValue(workView()) };
    shipmentQuery = { findByFulfillmentWorkIds: jest.fn().mockResolvedValue(new Map()) };
    shipmentDispatch = {
      dispatch: jest.fn().mockResolvedValue({ kind: 'dispatched', shipment: { id: 'ol_shipment_1' } }),
    };
    orderRecords = { getOrderRecord: jest.fn().mockResolvedValue(readyRecord()) };
    products = { getVariantsByIds: jest.fn().mockResolvedValue([{ id: 'v1', weightGrams: 200 }]) };

    handler = new FulfillmentWorkAutoDispatchHandler(
      integrations as never,
      worklist as never,
      shipmentQuery as never,
      shipmentDispatch as never,
      orderRecords as never,
      products as never
    );
  });

  it('should report a malformed payload as terminal without calling anything', async () => {
    expect(await handler.execute(job({ workId: '', orderId: 'o' }))).toEqual({
      outcome: 'business_failure',
    });
    expect(integrations.getAdapter).not.toHaveBeenCalled();
  });

  it('should refuse (not-enabled) when the connection has not opted in', async () => {
    integrations.getAdapter.mockResolvedValue({ connection: { config: {} }, metadata: {} });

    expect(await handler.execute(job(validPayload))).toEqual({ outcome: 'business_failure' });
    expect(worklist.get).not.toHaveBeenCalled();
    expect(shipmentDispatch.dispatch).not.toHaveBeenCalled();
  });

  it('should treat already-has-label as a no-op success, never a failure', async () => {
    shipmentQuery.findByFulfillmentWorkIds.mockResolvedValue(
      new Map([['w1', [{ providerShipmentId: 'ext-1' }]]])
    );

    expect(await handler.execute(job(validPayload))).toEqual({ outcome: 'ok' });
    expect(shipmentDispatch.dispatch).not.toHaveBeenCalled();
  });

  it('should NOT treat a failed (label-less) prior shipment as already-has-label', async () => {
    shipmentQuery.findByFulfillmentWorkIds.mockResolvedValue(
      new Map([['w1', [{ providerShipmentId: null }]]])
    );

    await handler.execute(job(validPayload));

    expect(shipmentDispatch.dispatch).toHaveBeenCalled();
  });

  it('should refuse (no-weight) when a variant carries no weight and no fallback is configured', async () => {
    products.getVariantsByIds.mockResolvedValue([{ id: 'v1', weightGrams: null }]);

    expect(await handler.execute(job(validPayload))).toEqual({ outcome: 'business_failure' });
    expect(shipmentDispatch.dispatch).not.toHaveBeenCalled();
  });

  it('should fall back to the configured defaultWeightGrams', async () => {
    integrations.getAdapter.mockResolvedValue({
      connection: { config: { autoDispatch: { enabled: true, defaultWeightGrams: 150 } } },
      metadata: {},
    });
    products.getVariantsByIds.mockResolvedValue([{ id: 'v1', weightGrams: null }]);

    await handler.execute(job(validPayload));

    expect(shipmentDispatch.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ parcel: { weightGrams: 300 } })
    );
  });

  it('should carry the operator-chosen parcelTemplate on the parcel', async () => {
    integrations.getAdapter.mockResolvedValue({
      connection: { config: { autoDispatch: { enabled: true, parcelTemplate: 'small' } } },
      metadata: {},
    });

    await handler.execute(job(validPayload));

    expect(shipmentDispatch.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ parcel: { weightGrams: 400, template: 'small' } })
    );
  });

  it('should refuse (no-address) when the order carries no deliverable recipient', async () => {
    orderRecords.getOrderRecord.mockResolvedValue(
      readyRecord({ shippingAddress: undefined, billingAddress: undefined })
    );

    expect(await handler.execute(job(validPayload))).toEqual({ outcome: 'business_failure' });
    expect(shipmentDispatch.dispatch).not.toHaveBeenCalled();
  });

  it('should build the dispatch input from the work and the order', async () => {
    await handler.execute(job(validPayload));

    expect(shipmentDispatch.dispatch).toHaveBeenCalledWith({
      sourceConnectionId: 'src-conn-1',
      sourceDeliveryMethodId: 'method-1',
      deliveryIntent: 'address',
      paczkomatId: undefined,
      orderId: 'ol_order_1',
      recipient: {
        firstName: 'Anna',
        lastName: 'Kowalska',
        email: 'buyer@example.com',
        phone: '+48123456789',
        address: {
          street: 'ul. Testowa 1',
          buildingNumber: 'ul. Testowa 1',
          city: 'Warszawa',
          postCode: '00-001',
          countryCode: 'PL',
        },
      },
      parcel: { weightGrams: 400 },
    });
  });

  it('should treat a work not found as RETRYABLE', async () => {
    worklist.get.mockRejectedValue(new FulfillmentWorkNotFoundError('w1'));

    await expect(handler.execute(job(validPayload))).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should treat an order record not found as RETRYABLE', async () => {
    orderRecords.getOrderRecord.mockResolvedValue(null);

    await expect(handler.execute(job(validPayload))).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should treat an unreadable order snapshot as RETRYABLE', async () => {
    orderRecords.getOrderRecord.mockResolvedValue({
      internalOrderId: 'ol_order_1',
      recordStatus: 'awaiting_mapping',
      orderSnapshot: {},
    });

    await expect(handler.execute(job(validPayload))).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should report a held/unpaid order as a TERMINAL business_failure (work-not-eligible)', async () => {
    shipmentDispatch.dispatch.mockRejectedValue(
      new OrderNotDispatchablePaymentStatusException('ol_order_1', 'awaiting')
    );

    expect(await handler.execute(job(validPayload))).toEqual({ outcome: 'business_failure' });
  });

  it('should report a held order as a TERMINAL business_failure (work-not-eligible)', async () => {
    shipmentDispatch.dispatch.mockRejectedValue(
      new OrderNotDispatchableHeldException('ol_order_1', 'hold-1', 'fraud_review')
    );

    expect(await handler.execute(job(validPayload))).toEqual({ outcome: 'business_failure' });
  });

  it('should report an unresolvable delivery shape as a TERMINAL business_failure (no-delivery-method)', async () => {
    shipmentDispatch.dispatch.mockRejectedValue(
      new UndispatchableResolutionException('no supported method')
    );

    expect(await handler.execute(job(validPayload))).toEqual({ outcome: 'business_failure' });
  });

  it('should treat a carrier rejection as RETRYABLE', async () => {
    shipmentDispatch.dispatch.mockRejectedValue(
      new ShippingProviderRejectionException('inpost', 'timeout', 'timed out')
    );

    await expect(handler.execute(job(validPayload))).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should treat any other adapter/infra failure as RETRYABLE', async () => {
    shipmentDispatch.dispatch.mockRejectedValue(new Error('network blip'));

    await expect(handler.execute(job(validPayload))).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should return ok on an omp_fulfilled result with no label bought', async () => {
    shipmentDispatch.dispatch.mockResolvedValue({ kind: 'omp_fulfilled' });

    expect(await handler.execute(job(validPayload))).toEqual({ outcome: 'ok' });
  });

  it('should skip the variant lookup entirely for a work with no lines', async () => {
    worklist.get.mockResolvedValue(workView({ lines: [] }));

    expect(await handler.execute(job(validPayload))).toEqual({ outcome: 'business_failure' });
    expect(products.getVariantsByIds).not.toHaveBeenCalled();
  });
});
