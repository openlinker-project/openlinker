/**
 * AmazonMcfFulfillmentExecutorAdapter tests (#4185)
 *
 * Runs against an in-memory Amazon Fulfillment Outbound API, including the
 * shared fulfilment executor contract kit.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/fulfillment-executor/__tests__
 */
import type { FulfillmentRequest } from '@openlinker/core/fulfillment';
import {
  FULFILLMENT_EXECUTOR_CONTRACT_REQUEST,
  runFulfillmentExecutorContract,
} from '@openlinker/core/fulfillment/testing';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { InMemoryCacheAdapter } from '@openlinker/shared/cache/testing';

import { AmazonApiError } from '../../../../domain/exceptions/amazon-api.error';
import { amazonMcfOrderId } from '../../../../domain/policies/amazon-mcf-order-id.policy';
import type { AmazonMcfCreateRequest, AmazonMcfOrderResponse } from '../../../../domain/types/amazon-mcf.types';
import type { AmazonFulfillmentOutboundClient } from '../../../http/amazon-fulfillment-outbound.client';
import { AmazonMcfFulfillmentExecutorAdapter } from '../amazon-mcf-fulfillment-executor.adapter';

/** An in-memory Fulfillment Outbound API: orders by id, a stock-aware preview. */
class FakeOutbound {
  readonly orders = new Map<string, AmazonMcfOrderResponse>();
  readonly created: AmazonMcfCreateRequest[] = [];
  fulfillable = true;
  cancelled: string[] = [];

  preview = jest.fn(() =>
    Promise.resolve({
      payload: {
        fulfillmentPreviews: [
          this.fulfillable
            ? { isFulfillable: true }
            : { isFulfillable: false, unfulfillablePreviewItems: [{ sellerSku: 'MUG', itemUnfulfillableReasons: ['NoInventory'] }] },
        ],
      },
    }),
  );

  create = jest.fn((request: AmazonMcfCreateRequest) => {
    if (this.orders.has(request.sellerFulfillmentOrderId)) {
      return Promise.reject(new AmazonApiError(400, 'InvalidInput', 'duplicate sellerFulfillmentOrderId', 'r'));
    }
    this.created.push(request);
    this.orders.set(request.sellerFulfillmentOrderId, {
      payload: {
        fulfillmentOrder: {
          sellerFulfillmentOrderId: request.sellerFulfillmentOrderId,
          fulfillmentOrderStatus: 'Received',
          receivedDate: '2026-11-18T10:00:00Z',
          statusUpdatedDate: '2026-11-18T10:00:00Z',
        },
        fulfillmentOrderItems: request.items.map((item) => ({
          sellerSku: item.sellerSku,
          sellerFulfillmentOrderItemId: item.sellerFulfillmentOrderItemId,
          quantity: item.quantity,
        })),
        fulfillmentShipments: [],
      },
    });
    return Promise.resolve();
  });

  get = jest.fn((id: string) => Promise.resolve(this.orders.get(id) ?? null));

  cancel = jest.fn((id: string) => {
    const order = this.orders.get(id);
    const status = order?.payload?.fulfillmentOrder?.fulfillmentOrderStatus;
    if (order?.payload?.fulfillmentOrder && status !== undefined) {
      this.orders.set(id, {
        payload: { ...order.payload, fulfillmentOrder: { ...order.payload.fulfillmentOrder, fulfillmentOrderStatus: 'Cancelled' } },
      });
    }
    this.cancelled.push(id);
    return Promise.resolve();
  });

  setStatus(id: string, status: string): void {
    const order = this.orders.get(id);
    if (order?.payload?.fulfillmentOrder) {
      this.orders.set(id, { payload: { ...order.payload, fulfillmentOrder: { ...order.payload.fulfillmentOrder, fulfillmentOrderStatus: status } } });
    }
  }
}

const identifierMapping = {
  getExternalIds: jest.fn((_type: string, id: string) =>
    Promise.resolve(id === 'ol_variant_unmapped' ? [] : [{ externalId: 'MUG', connectionId: 'conn-amz' }]),
  ),
} as unknown as IdentifierMappingPort;

function setup(): { adapter: AmazonMcfFulfillmentExecutorAdapter; outbound: FakeOutbound; cache: InMemoryCacheAdapter } {
  const outbound = new FakeOutbound();
  const cache = new InMemoryCacheAdapter();
  const adapter = new AmazonMcfFulfillmentExecutorAdapter(
    outbound as unknown as AmazonFulfillmentOutboundClient,
    identifierMapping,
    { connectionId: 'conn-amz', marketplaceId: 'A1PA6795UKMFR9', shippingSpeed: 'Standard', now: () => new Date('2026-11-18T09:00:00Z') },
    cache,
  );
  return { adapter, outbound, cache };
}

const request = (overrides: Partial<FulfillmentRequest> = {}): FulfillmentRequest => ({
  ...FULFILLMENT_EXECUTOR_CONTRACT_REQUEST,
  ...overrides,
});

runFulfillmentExecutorContract(() => setup().adapter, { subject: 'AmazonMcfFulfillmentExecutorAdapter' });

describe('AmazonMcfFulfillmentExecutorAdapter', () => {
  it('should create one MCF order addressed to the buyer and accept with Amazon\'s instant', async () => {
    const { adapter, outbound } = setup();

    const result = await adapter.requestFulfillment(request());

    expect(outbound.created).toHaveLength(1);
    expect(outbound.created[0]).toEqual({
      marketplaceId: 'A1PA6795UKMFR9',
      sellerFulfillmentOrderId: amazonMcfOrderId('work:ol_fulfillmentwork_contract_fixture:1'),
      displayableOrderId: 'contract_fixture',
      displayableOrderDate: '2026-11-18T09:00:00.000Z',
      displayableOrderComment: 'Thank you for your order.',
      shippingSpeedCategory: 'Standard',
      destinationAddress: {
        name: 'Contract Fixture',
        addressLine1: 'Prosta 1',
        city: 'Warszawa',
        postalCode: '00-001',
        countryCode: 'PL',
      },
      items: [{ sellerSku: 'MUG', sellerFulfillmentOrderItemId: 'work-line-1', quantity: 2 }],
    });
    expect(outbound.created[0].sellerFulfillmentOrderId.length).toBeLessThanOrEqual(40);
    expect(result).toEqual({
      status: 'accepted',
      externalWorkId: outbound.created[0].sellerFulfillmentOrderId,
      acceptedAt: new Date('2026-11-18T10:00:00Z'),
    });
  });

  it('should never create a second order on a retry of the same attempt', async () => {
    const { adapter, outbound } = setup();

    await adapter.requestFulfillment(request());
    await adapter.requestFulfillment(request());

    expect(outbound.created).toHaveLength(1);
  });

  it('should create a new order for a new attempt', async () => {
    const { adapter, outbound } = setup();

    await adapter.requestFulfillment(request());
    await adapter.requestFulfillment(request({ idempotencyKey: 'work:ol_fulfillmentwork_contract_fixture:2' }));

    expect(outbound.created).toHaveLength(2);
  });

  it('should reject, blocking, work Amazon cannot fulfil from FBA stock', async () => {
    const { adapter, outbound } = setup();
    outbound.fulfillable = false;

    await expect(adapter.requestFulfillment(request())).resolves.toEqual({
      status: 'rejected',
      reason: 'not-fulfillable-by-amazon',
      blocking: true,
      detail: 'MUG: NoInventory',
    });
    expect(outbound.created).toHaveLength(0);
  });

  it('should reject work without a delivery address or with a variant Amazon has no SKU for', async () => {
    const { adapter, outbound } = setup();

    await expect(adapter.requestFulfillment(request({ deliveryAddress: null }))).resolves.toEqual(
      expect.objectContaining({ status: 'rejected', reason: 'delivery-address-unavailable', blocking: true }),
    );
    await expect(
      adapter.requestFulfillment(
        request({ lines: [{ workLineId: 'work-line-1', productVariantId: 'ol_variant_unmapped', quantity: 1 }] }),
      ),
    ).resolves.toEqual(expect.objectContaining({ status: 'rejected', reason: 'sku-not-on-amazon' }));
    expect(outbound.preview).not.toHaveBeenCalled();
  });

  it('should cancel an order Amazon has not started, and refuse one it is processing', async () => {
    const { adapter, outbound } = setup();
    await adapter.requestFulfillment(request());
    const cancellation = {
      work: request().work,
      reason: 'operator_forced' as const,
      idempotencyKey: 'work:ol_fulfillmentwork_contract_fixture:1:cancel',
    };

    await expect(adapter.requestCancellation(cancellation)).resolves.toEqual(expect.objectContaining({ status: 'accepted' }));
    expect(outbound.cancelled).toHaveLength(1);

    const processing = setup();
    await processing.adapter.requestFulfillment(request());
    processing.outbound.setStatus(amazonMcfOrderId('work:ol_fulfillmentwork_contract_fixture:1'), 'Processing');
    await expect(processing.adapter.requestCancellation(cancellation)).resolves.toEqual(
      expect.objectContaining({ status: 'rejected', reason: 'already-processing', blocking: false }),
    );
    expect(processing.outbound.cancelled).toHaveLength(0);
  });

  it('should report shipped and cancelled units per work line', async () => {
    const { adapter, outbound } = setup();
    await adapter.requestFulfillment(request());
    const id = amazonMcfOrderId('work:ol_fulfillmentwork_contract_fixture:1');
    outbound.orders.set(id, {
      payload: {
        fulfillmentOrder: {
          sellerFulfillmentOrderId: id,
          fulfillmentOrderStatus: 'CompletePartialled',
          statusUpdatedDate: '2026-11-19T08:00:00Z',
        },
        fulfillmentOrderItems: [{ sellerFulfillmentOrderItemId: 'work-line-1', quantity: 2, unfulfillableQuantity: 1 }],
        fulfillmentShipments: [
          {
            fulfillmentShipmentStatus: 'SHIPPED',
            fulfillmentShipmentItem: [{ sellerFulfillmentOrderItemId: 'work-line-1', quantity: 1 }],
            fulfillmentShipmentPackage: [{ carrierCode: 'DPD', trackingNumber: 'T1' }],
          },
        ],
      },
    });

    await expect(adapter.getWorkFulfillmentStatus(request().work)).resolves.toEqual({
      work: request().work,
      externalWorkId: id,
      lines: [{ workLineId: 'work-line-1', fulfilledQuantity: 1, cancelledQuantity: 1 }],
      observedAt: new Date('2026-11-19T08:00:00Z'),
    });
  });

  it('should find the work\'s order without the cache by probing its attempts', async () => {
    const { outbound } = setup();
    const first = new AmazonMcfFulfillmentExecutorAdapter(
      outbound as unknown as AmazonFulfillmentOutboundClient,
      identifierMapping,
      { connectionId: 'conn-amz', marketplaceId: 'A1PA6795UKMFR9', shippingSpeed: 'Standard' },
    );
    await first.requestFulfillment(request());

    const snapshot = await first.getWorkFulfillmentStatus(request().work);

    expect(snapshot.externalWorkId).toBe(amazonMcfOrderId('work:ol_fulfillmentwork_contract_fixture:1'));
  });
});
