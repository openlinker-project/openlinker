/**
 * WooCommerce Order Processor Adapter — FulfillmentStatusReader unit tests
 *
 * Covers the getFulfillmentStatus read path (#1550): the isFulfillmentStatusReader
 * guard, the GET /orders/{id} call + mapping, id validation, and 404 handling.
 * Mocks IWooCommerceHttpClient and IdentifierMappingPort.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor/__tests__
 */
import { WooCommerceOrderProcessorAdapter } from '../woocommerce-order-processor.adapter';
import { isFulfillmentStatusReader, FULFILLMENT_STATUS } from '@openlinker/core/orders';
import type { IWooCommerceHttpClient } from '../../../http/woocommerce-http-client.interface';
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { WooCommerceResourceNotFoundException } from '../../../../domain/exceptions/woocommerce-resource-not-found.exception';
import { WooCommerceInvalidArgumentException } from '../../../../domain/exceptions/woocommerce-invalid-argument.exception';
import { WooCommerceHttpResponseException } from '../../../http/woocommerce-http-response.exception';

const CONNECTION_ID = 'conn-wc-001';

const mockConnection: Connection = {
  id: CONNECTION_ID,
  platformType: 'woocommerce',
  name: 'Test WC Store',
  status: 'active',
  config: { siteUrl: 'https://myshop.com' } as Record<string, unknown>,
  credentialsRef: 'cred-ref-001',
  adapterKey: 'woocommerce.restapi.v3',
  enabledCapabilities: ['OrderProcessorManager'],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeHttpClient(): jest.Mocked<IWooCommerceHttpClient> {
  return {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  };
}

function makeIdentifierMapping(): jest.Mocked<IdentifierMappingPort> {
  return {
    getOrCreateInternalId: jest.fn(),
    getOrCreateExactMapping: jest.fn(),
    getInternalId: jest.fn(),
    getExternalIds: jest.fn(),
    createMapping: jest.fn(),
    batchGetOrCreateInternalIds: jest.fn(),
    deleteMapping: jest.fn(),
    listExternalIdsByConnection: jest.fn(),
  };
}

function makeAdapter(
  httpClient: jest.Mocked<IWooCommerceHttpClient>,
): WooCommerceOrderProcessorAdapter {
  return new WooCommerceOrderProcessorAdapter(httpClient, makeIdentifierMapping(), mockConnection);
}

describe('WooCommerceOrderProcessorAdapter — FulfillmentStatusReader', () => {
  it('should pass the isFulfillmentStatusReader guard', () => {
    const adapter = makeAdapter(makeHttpClient());
    expect(isFulfillmentStatusReader(adapter)).toBe(true);
  });

  it('should GET the order and return the mapped fulfillment snapshot', async () => {
    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({
      id: 123,
      status: 'completed',
      date_completed_gmt: '2026-07-14T10:30:00',
    });
    const adapter = makeAdapter(httpClient);

    const snapshot = await adapter.getFulfillmentStatus({ externalOrderId: '123' });

    expect(httpClient.get).toHaveBeenCalledWith('/wp-json/wc/v3/orders/123');
    expect(snapshot).toEqual({
      status: FULFILLMENT_STATUS.Delivered,
      trackingNumber: null,
      deliveredAt: new Date('2026-07-14T10:30:00Z'),
    });
  });

  it('should return a null-status snapshot for a pre-fulfillment order', async () => {
    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ id: 5, status: 'processing' });
    const adapter = makeAdapter(httpClient);

    const snapshot = await adapter.getFulfillmentStatus({ externalOrderId: '5' });

    expect(snapshot.status).toBeNull();
    expect(snapshot.deliveredAt).toBeNull();
  });

  it('should reject a non-integer externalOrderId before any HTTP call', async () => {
    const httpClient = makeHttpClient();
    const adapter = makeAdapter(httpClient);

    await expect(
      adapter.getFulfillmentStatus({ externalOrderId: '12/../../etc' }),
    ).rejects.toBeInstanceOf(WooCommerceInvalidArgumentException);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('should throw WooCommerceResourceNotFoundException on a 404', async () => {
    const httpClient = makeHttpClient();
    httpClient.get.mockRejectedValue(new WooCommerceHttpResponseException(404, 'Not Found'));
    const adapter = makeAdapter(httpClient);

    await expect(
      adapter.getFulfillmentStatus({ externalOrderId: '999' }),
    ).rejects.toBeInstanceOf(WooCommerceResourceNotFoundException);
  });

  it('should propagate non-404 errors unchanged', async () => {
    const httpClient = makeHttpClient();
    const err = new WooCommerceHttpResponseException(500, 'Server Error');
    httpClient.get.mockRejectedValue(err);
    const adapter = makeAdapter(httpClient);

    await expect(adapter.getFulfillmentStatus({ externalOrderId: '7' })).rejects.toBe(err);
  });
});
