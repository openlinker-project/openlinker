/**
 * AmazonOrderSourceAdapter tests (#4178)
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/order-source/__tests__
 */
import { isInboundQueueReader } from '@openlinker/core/integrations';

import { amazonPackageReferenceId } from '../../../../domain/policies/amazon-package-reference.policy';
import { AmazonApiError } from '../../../../domain/exceptions/amazon-api.error';
import type { AmazonSpApiClient } from '../../../http/amazon-spapi-client';
import { amazonFbmOrder } from '../../../__tests__/amazon-order.fixture';
import { AmazonOrderSourceAdapter } from '../amazon-order-source.adapter';
import { AmazonQueuedOrderSourceAdapter } from '../amazon-queued-order-source.adapter';

const NOW = new Date('2026-11-17T12:00:00.000Z');
const CONFIG = { region: 'eu' as const, environment: 'production' as const, marketplaceIds: ['A1PA6795UKMFR9'] };

function clientStub(): { client: AmazonSpApiClient; get: jest.Mock; post: jest.Mock } {
  const get = jest.fn();
  const post = jest.fn().mockResolvedValue({ status: 204, data: {}, requestId: 'r' });
  return { client: { get, post } as unknown as AmazonSpApiClient, get, post };
}

const adapter = (client: AmazonSpApiClient): AmazonOrderSourceAdapter =>
  new AmazonOrderSourceAdapter('conn-1', client, CONFIG, () => NOW);

describe('AmazonOrderSourceAdapter.listOrderFeed', () => {
  it('should search by watermark and key each item by order and update time', async () => {
    const { client, get } = clientStub();
    get.mockResolvedValue({
      status: 200,
      requestId: 'r',
      data: {
        orders: [
          amazonFbmOrder({ orderId: 'A', createdTime: '2026-11-17T10:00:00Z', lastUpdatedTime: '2026-11-17T10:00:00Z' }),
          amazonFbmOrder({ orderId: 'B', lastUpdatedTime: '2026-11-17T10:30:00Z' }),
          amazonFbmOrder({ orderId: 'C', fulfillment: { fulfillmentStatus: 'CANCELLED' } }),
        ],
        lastUpdatedBefore: '2026-11-17T11:58:00Z',
      },
    });

    const result = await adapter(client).listOrderFeed({ fromCursor: null, limit: 500 });

    expect(get).toHaveBeenCalledWith('/orders/2026-01-01/orders', {
      marketplaceIds: ['A1PA6795UKMFR9'],
      lastUpdatedAfter: '2000-01-01T00:00:00.000Z',
      maxResultsPerPage: 100,
    });
    expect(result.items.map((item) => [item.externalOrderId, item.eventType])).toEqual([
      ['A', 'created'],
      ['B', 'updated'],
      ['C', 'cancelled'],
    ]);
    expect(result.items[1].eventKey).toBe('B:2026-11-17T10:30:00Z');
    expect(JSON.parse(result.nextCursor ?? '')).toEqual({
      since: '2026-11-17T11:56:00.000Z',
      marketplaceIds: ['A1PA6795UKMFR9'],
    });
  });

  it('should rewind the watermark and drop the token when the connection gained a marketplace', async () => {
    const { client, get } = clientStub();
    get.mockResolvedValue({ status: 200, requestId: 'r', data: { orders: [] } });
    const wider = new AmazonOrderSourceAdapter(
      'conn-1',
      client,
      { ...CONFIG, marketplaceIds: ['A1PA6795UKMFR9', 'A1C3SOZRARQ6R3'] },
      () => NOW,
    );
    const fromCursor = JSON.stringify({
      since: '2026-11-17T11:00:00.000Z',
      paginationToken: 'p2',
      tokenIssuedAt: '2026-11-17T11:30:00.000Z',
      marketplaceIds: ['A1PA6795UKMFR9'],
    });

    await wider.listOrderFeed({ fromCursor, limit: 50 });

    const params = (get.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(params.lastUpdatedAfter).toBe('2000-01-01T00:00:00.000Z');
    expect(params.paginationToken).toBeUndefined();
  });

  it('should pass the pagination token while a window has more pages', async () => {
    const { client, get } = clientStub();
    get.mockResolvedValue({ status: 200, requestId: 'r', data: { orders: [], pagination: { nextToken: 'p3' } } });
    const fromCursor = JSON.stringify({ since: '2026-11-17T08:00:00.000Z', paginationToken: 'p2', tokenIssuedAt: '2026-11-17T11:00:00.000Z' });

    const result = await adapter(client).listOrderFeed({ fromCursor, limit: 50 });

    expect((get.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({ paginationToken: 'p2', maxResultsPerPage: 50 });
    expect(JSON.parse(result.nextCursor ?? '')).toMatchObject({ since: '2026-11-17T08:00:00.000Z', paginationToken: 'p3' });
  });
});

describe('AmazonOrderSourceAdapter.getOrder', () => {
  it('should read a recent order again with buyer, recipient and proceeds', async () => {
    const { client, get } = clientStub();
    get.mockResolvedValue({ status: 200, requestId: 'r', data: { order: amazonFbmOrder() } });

    const order = await adapter(client).getOrder({ externalOrderId: '302-1234567-7654321' });

    expect(get).toHaveBeenNthCalledWith(1, '/orders/2026-01-01/orders/302-1234567-7654321', {
      includedData: ['PROCEEDS', 'FULFILLMENT', 'PAYMENT', 'TAX', 'PACKAGES'],
    });
    expect(get).toHaveBeenNthCalledWith(2, '/orders/2026-01-01/orders/302-1234567-7654321', {
      includedData: ['BUYER', 'RECIPIENT', 'PROCEEDS', 'FULFILLMENT', 'PAYMENT', 'TAX', 'PACKAGES'],
    });
    expect(order.externalOrderId).toBe('302-1234567-7654321');
    expect(order.customerEmail).toBe('abc123@marketplace.amazon.de');
  });

  it('should never fetch the buyer data of an order shipped-by more than 30 days ago', async () => {
    const { client, get } = clientStub();
    const withoutBuyer = amazonFbmOrder({
      createdTime: '2026-10-01T09:00:00Z',
      buyer: undefined,
      recipient: undefined,
      fulfillment: { fulfillmentStatus: 'SHIPPED', shipByWindow: { latestDateTime: '2026-10-03T22:59:59Z' } },
    });
    get.mockResolvedValue({ status: 200, requestId: 'r', data: { order: withoutBuyer } });

    const order = await adapter(client).getOrder({ externalOrderId: '302-1234567-7654321' });

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/orders/2026-01-01/orders/302-1234567-7654321', {
      includedData: ['PROCEEDS', 'FULFILLMENT', 'PAYMENT', 'TAX', 'PACKAGES'],
    });
    expect(order.customerEmail).toBeUndefined();
  });

  it('should key lines by the reference the connection role resolves through', async () => {
    const { client, get } = clientStub();
    get.mockResolvedValue({ status: 200, requestId: 'r', data: { order: amazonFbmOrder() } });

    const asOffer = await adapter(client).getOrder({ externalOrderId: '302-1234567-7654321' });
    const asVariant = await new AmazonOrderSourceAdapter('conn-1', client, CONFIG, () => NOW, undefined, 'variant').getOrder({
      externalOrderId: '302-1234567-7654321',
    });

    expect(asOffer.items[0].productRef).toEqual({ type: 'offer', externalId: 'MUG-BLUE' });
    expect(asVariant.items[0].productRef).toEqual({ type: 'variant', externalId: 'MUG-BLUE' });
  });
});

describe('AmazonOrderSourceAdapter order sync start (#4228)', () => {
  it('should start "from now" two minutes back for the connection\'s marketplaces', async () => {
    const { client, get } = clientStub();
    get.mockResolvedValue({ status: 200, requestId: 'r', data: { orders: [amazonFbmOrder()] } });

    const head = await adapter(client).headCursor();

    expect(get).toHaveBeenCalledWith('/orders/2026-01-01/orders', {
      marketplaceIds: ['A1PA6795UKMFR9'],
      lastUpdatedAfter: '2000-01-01T00:00:00.000Z',
      maxResultsPerPage: 1,
    });
    expect(JSON.parse(head ?? '')).toEqual({ since: '2026-11-17T11:58:00.000Z', marketplaceIds: ['A1PA6795UKMFR9'] });
  });

  it('should answer null for an account with no orders', async () => {
    const { client, get } = clientStub();
    get.mockResolvedValue({ status: 200, requestId: 'r', data: { orders: [] } });

    await expect(adapter(client).headCursor()).resolves.toBeNull();
  });

  it('should start a bare day at midnight UTC', async () => {
    const { client } = clientStub();

    const cursor = await adapter(client).cursorForDate('2026-11-01');

    expect(JSON.parse(cursor)).toEqual({ since: '2026-11-01T00:00:00.000Z', marketplaceIds: ['A1PA6795UKMFR9'] });
  });

  it('should refuse a future date and a value that is not a date', async () => {
    const { client } = clientStub();

    await expect(adapter(client).cursorForDate('2026-12-01')).rejects.toMatchObject({
      name: 'OrderSyncStartUnavailableError',
    });
    await expect(adapter(client).cursorForDate('yesterday')).rejects.toMatchObject({
      name: 'OrderSyncStartUnavailableError',
    });
  });
});

describe('AmazonOrderSourceAdapter.write', () => {
  it('should confirm the shipment with the carrier code and every line', async () => {
    const { client, get, post } = clientStub();
    get.mockResolvedValue({ status: 200, requestId: 'r', data: { order: amazonFbmOrder() } });

    const result = await adapter(client).write({
      type: 'dispatched',
      externalOrderId: '302-1234567-7654321',
      trackingNumber: '520000011',
      carrier: { platformType: 'inpost' },
    });

    expect(result).toEqual({ outcome: 'applied' });
    // The confirmation reads no buyer data (Amazon's Data Protection Policy).
    expect(get).toHaveBeenCalledWith('/orders/2026-01-01/orders/302-1234567-7654321', {
      includedData: ['PROCEEDS', 'FULFILLMENT', 'PAYMENT', 'TAX', 'PACKAGES'],
    });
    expect(post).toHaveBeenCalledWith('/orders/v0/orders/302-1234567-7654321/shipmentConfirmation', {
      marketplaceId: 'A1PA6795UKMFR9',
      packageDetail: {
        packageReferenceId: amazonPackageReferenceId('520000011'),
        carrierCode: 'InPost',
        trackingNumber: '520000011',
        shipDate: NOW.toISOString(),
        orderItems: [
          { orderItemId: '11111111111111', quantity: 2 },
          { orderItemId: '22222222222222', quantity: 1 },
        ],
      },
    });
  });

  it('should send an unknown carrier as Other with its name', async () => {
    const { client, get, post } = clientStub();
    get.mockResolvedValue({ status: 200, requestId: 'r', data: { order: amazonFbmOrder() } });
    await adapter(client).write({
      type: 'dispatched',
      externalOrderId: 'x',
      trackingNumber: 'T1',
      carrier: { platformType: 'gls' },
    });
    expect((post.mock.calls[0] as [string, { packageDetail: unknown }])[1].packageDetail).toMatchObject({
      carrierCode: 'Other',
      carrierName: 'gls',
    });
  });

  it('should wait for a tracking number rather than confirm without one', async () => {
    const { client, post } = clientStub();
    const result = await adapter(client).write({ type: 'dispatched', externalOrderId: 'x' });
    expect(result.outcome).toBe('unsupported');
    expect(post).not.toHaveBeenCalled();
  });

  it('should not confirm an order Amazon ships itself', async () => {
    const { client, get, post } = clientStub();
    get.mockResolvedValue({
      status: 200,
      requestId: 'r',
      data: { order: amazonFbmOrder({ fulfillment: { fulfillmentStatus: 'UNSHIPPED', fulfilledBy: 'AMAZON' } }) },
    });
    const result = await adapter(client).write({ type: 'dispatched', externalOrderId: 'x', trackingNumber: 'T' });
    expect(result.outcome).toBe('unsupported');
    expect(post).not.toHaveBeenCalled();
  });

  it('should report a throttle as a transient rejection, never throw', async () => {
    const { client, get, post } = clientStub();
    get.mockResolvedValue({ status: 200, requestId: 'r', data: { order: amazonFbmOrder() } });
    post.mockRejectedValue(new AmazonApiError(429, 'QuotaExceeded', 'slow down', 'r'));
    await expect(
      adapter(client).write({ type: 'dispatched', externalOrderId: 'x', trackingNumber: 'T' }),
    ).resolves.toMatchObject({ outcome: 'rejected', transient: true });
  });

  it('should decline a refused shipment as a non-transient rejection', async () => {
    const { client, get, post } = clientStub();
    get.mockResolvedValue({ status: 200, requestId: 'r', data: { order: amazonFbmOrder() } });
    post.mockRejectedValue(new AmazonApiError(400, 'InvalidInput', 'bad item', 'r'));
    const result = await adapter(client).write({ type: 'dispatched', externalOrderId: 'x', trackingNumber: 'T' });
    expect(result).toMatchObject({ outcome: 'rejected' });
    expect(result.transient).toBeUndefined();
  });

  it.each(['cancelled', 'delivered', 'in-progress'] as const)('should report %s as unsupported', async (type) => {
    const { client } = clientStub();
    const result = await adapter(client).write({ type, externalOrderId: 'x' });
    expect(result.outcome).toBe('unsupported');
  });
});

describe('AmazonOrderSourceAdapter options', () => {
  it('should list the documented statuses and service levels', async () => {
    const { client } = clientStub();
    const source = adapter(client);
    expect((await source.listOrderStatuses()).map((option) => option.value)).toContain('UNSHIPPED');
    expect((await source.listDeliveryMethods()).map((option) => option.value)).toContain('STANDARD');
    expect((await source.listPaymentMethods()).map((option) => option.value)).toContain('CashOnDelivery');
  });
});

describe('AmazonQueuedOrderSourceAdapter (#4179)', () => {
  it('should read the queue and translate each message', async () => {
    const { client } = clientStub();
    const queue = {
      receiveMessages: jest.fn().mockResolvedValue([
        {
          MessageId: 'm1',
          ReceiptHandle: 'h1',
          Body: JSON.stringify({
            NotificationType: 'ORDER_CHANGE',
            Payload: { OrderChangeNotification: { AmazonOrderId: '302-1', OrderChangeType: 'OrderStatusChange' } },
          }),
        },
      ]),
      deleteMessages: jest.fn().mockResolvedValue(undefined),
    };
    const source = new AmazonQueuedOrderSourceAdapter('conn-1', client, CONFIG, queue as never, () => NOW);

    const messages = await source.receiveInboundMessages({ maxMessages: 10 });
    await source.acknowledgeInboundMessages(['h1']);

    expect(messages[0].events[0]).toMatchObject({ domain: 'order', externalId: '302-1' });
    expect(queue.deleteMessages).toHaveBeenCalledWith(['h1']);
  });

  it('should be an inbound queue reader, while the plain order source is not', () => {
    const { client } = clientStub();
    const queue = { receiveMessages: jest.fn(), deleteMessages: jest.fn() };

    expect(isInboundQueueReader(new AmazonQueuedOrderSourceAdapter('conn-1', client, CONFIG, queue as never))).toBe(true);
    expect(isInboundQueueReader(adapter(client))).toBe(false);
  });
});

describe('AmazonOrderSourceAdapter.readFulfillment', () => {
  it('should report an FBA order Amazon shipped as dispatched with no waybills', async () => {
    const { client, get } = clientStub();
    get.mockResolvedValue({
      status: 200,
      requestId: 'r',
      data: { order: amazonFbmOrder({ fulfillment: { fulfillmentStatus: 'SHIPPED', fulfilledBy: 'AMAZON' } }) },
    });

    const result = await adapter(client).readFulfillment({ externalOrderId: 'x' });

    // Status and packages only: the read-back never fetches the buyer's data.
    expect(get).toHaveBeenCalledWith('/orders/2026-01-01/orders/x', { includedData: ['FULFILLMENT', 'PACKAGES'] });
    expect(result).toEqual({ outcome: 'read', rawStatus: 'SHIPPED', dispatched: true, waybills: [] });
  });

  it('should report the tracking numbers of the packages the seller confirmed', async () => {
    const { client, get } = clientStub();
    get.mockResolvedValue({
      status: 200,
      requestId: 'r',
      data: {
        order: amazonFbmOrder({
          fulfillment: { fulfillmentStatus: 'SHIPPED', fulfilledBy: 'MERCHANT' },
          packages: [
            { packageReferenceId: '1', carrier: 'DPD', trackingNumber: ' 0950123 ' },
            { packageReferenceId: '2', carrier: 'DPD' },
          ],
        }),
      },
    });

    const result = await adapter(client).readFulfillment({ externalOrderId: 'x' });

    expect(result.waybills).toEqual([{ waybill: '0950123', carrierName: 'DPD' }]);
  });

  it('should read an unshipped order as not dispatched and an unknown status as unknown', async () => {
    const { client, get } = clientStub();
    get.mockResolvedValueOnce({
      status: 200,
      requestId: 'r',
      data: { order: amazonFbmOrder({ fulfillment: { fulfillmentStatus: 'UNSHIPPED' } }) },
    });
    get.mockResolvedValueOnce({
      status: 200,
      requestId: 'r',
      data: { order: amazonFbmOrder({ fulfillment: { fulfillmentStatus: 'SOMETHING_NEW' } }) },
    });

    await expect(adapter(client).readFulfillment({ externalOrderId: 'x' })).resolves.toMatchObject({ dispatched: false });
    await expect(adapter(client).readFulfillment({ externalOrderId: 'x' })).resolves.toMatchObject({ dispatched: null });
  });

  it('should report a failed read as unavailable, never throw', async () => {
    const { client, get } = clientStub();
    get.mockRejectedValue(new AmazonApiError(500, 'InternalFailure', 'boom', 'r'));

    await expect(adapter(client).readFulfillment({ externalOrderId: 'x' })).resolves.toMatchObject({
      outcome: 'unavailable',
      rawStatus: null,
    });
  });
});
