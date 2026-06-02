/**
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/__tests__
 */
import { WooCommerceOrderSourceAdapter } from '../woocommerce-order-source.adapter';
import { WooCommerceHttpResponseException } from '../../http/woocommerce-http-response.exception';
import { WooCommerceResourceNotFoundException } from '../../../domain/exceptions/woocommerce-resource-not-found.exception';
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { WooCommerceOrder } from '../order-source/woocommerce-order.types';

const makeConnection = (overrides: Partial<Connection> = {}): Connection =>
  ({
    id: 'conn-wc-1',
    platformType: 'woocommerce',
    name: 'Test WC',
    status: 'active',
    config: { siteUrl: 'https://myshop.example.com' },
    credentialsRef: 'cred-ref-001',
    enabledCapabilities: ['OrderSource'],
    adapterKey: 'woocommerce.restapi.v3',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as unknown as Connection;

const makeOrder = (overrides: Partial<WooCommerceOrder> = {}): WooCommerceOrder => ({
  id: 1,
  number: '1001',
  status: 'pending',
  date_created: '2024-01-15T10:00:00',
  date_created_gmt: '2024-01-15T10:00:00',
  date_modified: '2024-01-15T10:00:00',
  date_modified_gmt: '2024-01-15T10:00:00',
  customer_id: 5,
  billing: {
    first_name: 'John',
    last_name: 'Doe',
    company: '',
    address_1: '123 Main St',
    address_2: '',
    city: 'Warsaw',
    state: 'MZ',
    postcode: '00-001',
    country: 'PL',
    email: 'john@example.com',
    phone: '+48123456789',
  },
  shipping: {
    first_name: 'John',
    last_name: 'Doe',
    company: '',
    address_1: '123 Main St',
    address_2: '',
    city: 'Warsaw',
    state: 'MZ',
    postcode: '00-001',
    country: 'PL',
  },
  line_items: [
    {
      id: 10,
      name: 'Product A',
      product_id: 100,
      variation_id: 0,
      quantity: 2,
      sku: 'SKU-A',
      price: '49.99',
      subtotal: '99.98',
      total: '99.98',
      image: null,
    },
  ],
  shipping_lines: [
    { id: 1, method_id: 'flat_rate', method_title: 'Flat Rate', total: '5.00' },
  ],
  total: '109.98',
  total_tax: '5.00',
  shipping_total: '5.00',
  currency: 'PLN',
  ...overrides,
});

function makeHttpClient(impl: Partial<IWooCommerceHttpClient> = {}): jest.Mocked<IWooCommerceHttpClient> {
  return {
    get: jest.fn(),
    ...impl,
  } as unknown as jest.Mocked<IWooCommerceHttpClient>;
}

describe('WooCommerceOrderSourceAdapter', () => {
  describe('listOrderFeed', () => {
    it('should not include modified_after when fromCursor is null and no initialSyncFrom', async () => {
      const httpClient = makeHttpClient({ get: jest.fn().mockResolvedValue([]) });
      const adapter = new WooCommerceOrderSourceAdapter(httpClient, makeConnection());

      await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

      const [, params] = (httpClient.get as jest.Mock).mock.calls[0] as [string, Record<string, unknown>];
      expect(params).not.toHaveProperty('modified_after');
    });

    it('should use initialSyncFrom when fromCursor is null and config has it', async () => {
      const httpClient = makeHttpClient({ get: jest.fn().mockResolvedValue([]) });
      const conn = makeConnection({
        config: { siteUrl: 'https://myshop.example.com', orders: { initialSyncFrom: '2024-01-01' } },
      } as Partial<Connection>);
      const adapter = new WooCommerceOrderSourceAdapter(httpClient, conn);

      await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

      const [, params] = (httpClient.get as jest.Mock).mock.calls[0] as [string, Record<string, unknown>];
      expect(params.modified_after).toBe(new Date('2024-01-01').toISOString());
    });

    it('should pass fromCursor as modified_after when set', async () => {
      const httpClient = makeHttpClient({ get: jest.fn().mockResolvedValue([]) });
      const adapter = new WooCommerceOrderSourceAdapter(httpClient, makeConnection());
      const cursor = '2024-06-01T12:00:00Z';

      await adapter.listOrderFeed({ fromCursor: cursor, limit: 50 });

      const [, params] = (httpClient.get as jest.Mock).mock.calls[0] as [string, Record<string, unknown>];
      expect(params.modified_after).toBe(cursor);
    });

    it('should return empty items and preserve fromCursor on empty response', async () => {
      const httpClient = makeHttpClient({ get: jest.fn().mockResolvedValue([]) });
      const adapter = new WooCommerceOrderSourceAdapter(httpClient, makeConnection());
      const cursor = '2024-06-01T12:00:00Z';

      const result = await adapter.listOrderFeed({ fromCursor: cursor, limit: 10 });

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBe(cursor);
    });

    it('should return null nextCursor when fromCursor was null and response is empty', async () => {
      const httpClient = makeHttpClient({ get: jest.fn().mockResolvedValue([]) });
      const adapter = new WooCommerceOrderSourceAdapter(httpClient, makeConnection());

      const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

      expect(result.nextCursor).toBeNull();
    });

    it('should advance cursor to max date_modified_gmt across all orders before filtering', async () => {
      const orders = [
        makeOrder({ id: 1, status: 'pending', date_modified_gmt: '2024-01-15T10:00:00', date_created_gmt: '2024-01-15T10:00:00' }),
        makeOrder({ id: 2, status: 'completed', date_modified_gmt: '2024-01-15T12:00:00', date_created_gmt: '2024-01-10T08:00:00' }),
      ];
      const httpClient = makeHttpClient({ get: jest.fn().mockResolvedValue(orders) });
      const adapter = new WooCommerceOrderSourceAdapter(httpClient, makeConnection());

      // Only request 'created' events — order 2 (updated) would be filtered
      const result = await adapter.listOrderFeed({
        fromCursor: null,
        limit: 10,
        eventTypes: ['created'],
      });

      // Cursor must be max across ALL orders, not just filtered ones
      expect(result.nextCursor).toBe('2024-01-15T12:00:00Z');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].externalOrderId).toBe('1');
    });

    it('should map cancelled/refunded/failed status to cancelled event type', async () => {
      for (const status of ['cancelled', 'refunded', 'failed']) {
        const httpClient = makeHttpClient({
          get: jest.fn().mockResolvedValue([makeOrder({ id: 1, status, date_modified_gmt: '2024-01-15T11:00:00', date_created_gmt: '2024-01-10T08:00:00' })]),
        });
        const adapter = new WooCommerceOrderSourceAdapter(httpClient, makeConnection());
        const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });
        expect(result.items[0].eventType).toBe('cancelled');
      }
    });

    it('should map processing status to paid even when order is new', async () => {
      const httpClient = makeHttpClient({
        get: jest.fn().mockResolvedValue([
          makeOrder({ id: 1, status: 'processing', date_modified_gmt: '2024-01-15T10:00:00', date_created_gmt: '2024-01-15T10:00:00' }),
        ]),
      });
      const adapter = new WooCommerceOrderSourceAdapter(httpClient, makeConnection());

      const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

      expect(result.items[0].eventType).toBe('paid');
    });

    it('should map new pending order to created event type', async () => {
      const httpClient = makeHttpClient({
        get: jest.fn().mockResolvedValue([
          makeOrder({ id: 1, status: 'pending', date_modified_gmt: '2024-01-15T10:00:00', date_created_gmt: '2024-01-15T10:00:00' }),
        ]),
      });
      const adapter = new WooCommerceOrderSourceAdapter(httpClient, makeConnection());

      const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

      expect(result.items[0].eventType).toBe('created');
    });

    it('should map existing completed order to updated event type', async () => {
      const httpClient = makeHttpClient({
        get: jest.fn().mockResolvedValue([
          makeOrder({ id: 1, status: 'completed', date_modified_gmt: '2024-01-15T12:00:00', date_created_gmt: '2024-01-10T08:00:00' }),
        ]),
      });
      const adapter = new WooCommerceOrderSourceAdapter(httpClient, makeConnection());

      const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

      expect(result.items[0].eventType).toBe('updated');
    });
  });

  describe('getOrder', () => {
    it('should map variation_id > 0 to variant product ref', async () => {
      const order = makeOrder({
        line_items: [
          { id: 10, name: 'Variant Product', product_id: 100, variation_id: 55, quantity: 1, sku: 'VAR-A', price: '29.99', subtotal: '29.99', total: '29.99', image: null },
        ],
      });
      const httpClient = makeHttpClient({ get: jest.fn().mockResolvedValue(order) });
      const adapter = new WooCommerceOrderSourceAdapter(httpClient, makeConnection());

      const result = await adapter.getOrder({ externalOrderId: '1' });

      expect(result.items[0].productRef).toEqual({ type: 'variant', externalId: '55' });
    });

    it('should map customer_id = 0 to undefined customerExternalId (guest order)', async () => {
      const httpClient = makeHttpClient({ get: jest.fn().mockResolvedValue(makeOrder({ customer_id: 0 })) });
      const adapter = new WooCommerceOrderSourceAdapter(httpClient, makeConnection());

      const result = await adapter.getOrder({ externalOrderId: '1' });

      expect(result.customerExternalId).toBeUndefined();
    });

    it('should map empty billing email to undefined customerEmail', async () => {
      const order = makeOrder();
      order.billing.email = '';
      const httpClient = makeHttpClient({ get: jest.fn().mockResolvedValue(order) });
      const adapter = new WooCommerceOrderSourceAdapter(httpClient, makeConnection());

      const result = await adapter.getOrder({ externalOrderId: '1' });

      expect(result.customerEmail).toBeUndefined();
    });

    it('should throw WooCommerceResourceNotFoundException for non-numeric externalOrderId', async () => {
      const httpClient = makeHttpClient({ get: jest.fn() });
      const adapter = new WooCommerceOrderSourceAdapter(httpClient, makeConnection());

      await expect(adapter.getOrder({ externalOrderId: '../etc/passwd' })).rejects.toBeInstanceOf(
        WooCommerceResourceNotFoundException,
      );
      expect(httpClient.get).not.toHaveBeenCalled();
    });

    it('should convert WooCommerceHttpResponseException(404) to WooCommerceResourceNotFoundException', async () => {
      const httpClient = makeHttpClient({
        get: jest.fn().mockRejectedValue(new WooCommerceHttpResponseException(404, 'not found')),
      });
      const adapter = new WooCommerceOrderSourceAdapter(httpClient, makeConnection());

      await expect(adapter.getOrder({ externalOrderId: '999' })).rejects.toBeInstanceOf(
        WooCommerceResourceNotFoundException,
      );
    });

    it('should propagate WooCommerceHttpResponseException(500) unchanged', async () => {
      const serverError = new WooCommerceHttpResponseException(500, 'server error');
      const httpClient = makeHttpClient({ get: jest.fn().mockRejectedValue(serverError) });
      const adapter = new WooCommerceOrderSourceAdapter(httpClient, makeConnection());

      await expect(adapter.getOrder({ externalOrderId: '1' })).rejects.toBe(serverError);
    });
  });
});
