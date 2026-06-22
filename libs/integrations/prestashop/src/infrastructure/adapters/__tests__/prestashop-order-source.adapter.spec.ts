/**
 * PrestaShop Order Source Adapter Tests
 *
 * Unit tests for PrestashopOrderSourceAdapter post-#328 port reshape.
 * Covers cursor-based `listOrderFeed` and `getOrder({externalOrderId})`
 * against the neutral OrderSourcePort surface.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { PrestashopOrderSourceAdapter } from '../prestashop-order-source.adapter';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';
import { createTestConnection } from '../../../__tests__/fixtures/connection.fixture';
import { PrestashopOrderMapper } from '../../mappers/prestashop-order.mapper';
import {
  PrestashopApiException,
  PrestashopResourceNotFoundException,
} from '@openlinker/integrations-prestashop';
import type {
  PrestashopOrder,
  PrestashopOrderRow,
} from '../../mappers/prestashop.mapper.interface';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';

describe('PrestashopOrderSourceAdapter', () => {
  let adapter: PrestashopOrderSourceAdapter;
  let mockHttpClient: jest.Mocked<IPrestashopWebserviceClient>;
  let connection: ReturnType<typeof createTestConnection>;
  let orderMapper: PrestashopOrderMapper;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    connection = createTestConnection();
    orderMapper = new PrestashopOrderMapper();
    adapter = new PrestashopOrderSourceAdapter(mockHttpClient, orderMapper, connection);
  });

  describe('listOrderFeed', () => {
    it('should return feed items with a monotonic cursor advance', async () => {
      const orders: PrestashopOrder[] = [
        {
          id: '1',
          reference: 'ORDER-1',
          date_add: '2024-01-01 10:00:00',
          date_upd: '2024-01-01 10:00:00',
        },
        {
          id: '2',
          reference: 'ORDER-2',
          date_add: '2024-01-02 09:00:00',
          date_upd: '2024-01-02 11:00:00',
        },
      ];
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

      const result = await adapter.listOrderFeed({ fromCursor: null, limit: 10 });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        externalOrderId: '1',
        eventType: 'created',
        occurredAt: '2024-01-01 10:00:00',
      });
      expect(result.items[1]).toMatchObject({
        externalOrderId: '2',
        eventType: 'updated',
        occurredAt: '2024-01-02 11:00:00',
      });
      expect(result.nextCursor).toBe('2024-01-02 11:00:00');
    });

    it('should return input cursor unchanged when the feed is empty', async () => {
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);
      const result = await adapter.listOrderFeed({ fromCursor: '2024-01-01 00:00:00', limit: 10 });
      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBe('2024-01-01 00:00:00');
    });

    it('should filter items by requested eventTypes', async () => {
      const orders: PrestashopOrder[] = [
        { id: '1', date_add: '2024-01-01 10:00:00', date_upd: '2024-01-01 10:00:00' },
        { id: '2', date_add: '2024-01-01 10:00:00', date_upd: '2024-01-02 12:00:00' },
      ];
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

      const result = await adapter.listOrderFeed({
        fromCursor: null,
        limit: 10,
        eventTypes: ['updated'],
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].externalOrderId).toBe('2');
    });

    it('should advance cursor past filtered-out items so a page of non-matching events is not re-fetched', async () => {
      const orders: PrestashopOrder[] = [
        { id: '1', date_add: '2024-01-01 10:00:00', date_upd: '2024-01-01 10:00:00' },
        { id: '2', date_add: '2024-01-02 09:00:00', date_upd: '2024-01-02 12:00:00' },
      ];
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orders);

      // Filter excludes every order on the page, but the cursor must still
      // advance to the max observed `date_upd` so the next call does not loop.
      const result = await adapter.listOrderFeed({
        fromCursor: '2024-01-01 00:00:00',
        limit: 10,
        eventTypes: ['cancelled'],
      });

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBe('2024-01-02 12:00:00');
    });
  });

  describe('getOrder', () => {
    it('should hydrate a full IncomingOrder by external order id', async () => {
      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-042',
        id_customer: '7',
        current_state: '2',
        total_paid: '99.99',
        total_paid_tax_incl: '99.99',
        total_paid_tax_excl: '99.99',
        total_shipping: '0',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 12:00:00',
      };
      const orderRows: PrestashopOrderRow[] = [
        {
          id: '100',
          product_id: '5',
          product_attribute_id: '0',
          product_quantity: '1',
          product_price: '99.99',
          product_reference: 'SKU-5',
        },
      ];

      mockHttpClient.getResource = jest.fn().mockResolvedValueOnce(prestashopOrder);
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(orderRows);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.externalOrderId).toBe('42');
      expect(incoming.customerExternalId).toBe('7');
      expect(incoming.createdAt).toBe('2024-01-01 10:00:00');
      expect(incoming.updatedAt).toBe('2024-01-01 12:00:00');
      // Buyer-placed time (#926) is PrestaShop `date_add`.
      expect(incoming.placedAt).toBe('2024-01-01 10:00:00');
      expect(incoming.items).toHaveLength(1);
      expect(incoming.items[0].productRef).toEqual({ type: 'product', externalId: '5' });
    });

    it('should translate a 404 from the webservice client into PrestashopResourceNotFoundException', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockRejectedValueOnce(new PrestashopApiException('Not Found', 404));
      await expect(adapter.getOrder({ externalOrderId: '999' })).rejects.toThrow(
        PrestashopResourceNotFoundException
      );
    });

    it('should propagate non-404 webservice errors unchanged (not mask them as not-found)', async () => {
      const serverError = new PrestashopApiException('Upstream 500', 500);
      mockHttpClient.getResource = jest.fn().mockRejectedValueOnce(serverError);
      await expect(adapter.getOrder({ externalOrderId: '999' })).rejects.toBe(serverError);
    });

    it('should propagate transport errors (no status code) unchanged', async () => {
      const networkError = new Error('ECONNREFUSED');
      mockHttpClient.getResource = jest.fn().mockRejectedValueOnce(networkError);
      await expect(adapter.getOrder({ externalOrderId: '999' })).rejects.toBe(networkError);
    });
  });

  describe('getOrder — pickupPoint resolution', () => {
    const baseOrder: PrestashopOrder = {
      id: '42',
      reference: 'ORDER-042',
      id_customer: '7',
      id_address_delivery: '5',
      current_state: '2',
      total_paid: '99.99',
      date_add: '2024-01-01 10:00:00',
      date_upd: '2024-01-01 12:00:00',
    };
    const baseOrderRows: PrestashopOrderRow[] = [];

    it('should populate pickupPoint when inpostPsModuleType is official_inpost and address2 is a paczkomat code', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection
      );
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValueOnce(baseOrder)
        .mockResolvedValueOnce({ id: '5', address2: 'POZ08A' });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toEqual({ id: 'POZ08A' });
      expect(mockHttpClient.getResource).toHaveBeenCalledTimes(2);
      expect(mockHttpClient.getResource).toHaveBeenNthCalledWith(2, 'addresses', '5');
    });

    it('should leave pickupPoint undefined when inpostPsModuleType is none', async () => {
      const noneConnection = createTestConnection({
        config: { inpostPsModuleType: 'none' },
      });
      const noneAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        noneConnection
      );
      mockHttpClient.getResource = jest.fn().mockResolvedValueOnce(baseOrder);
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await noneAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toBeUndefined();
      expect(mockHttpClient.getResource).toHaveBeenCalledTimes(1);
    });

    it('should leave pickupPoint undefined when inpostPsModuleType is absent', async () => {
      mockHttpClient.getResource = jest.fn().mockResolvedValueOnce(baseOrder);
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await adapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toBeUndefined();
      expect(mockHttpClient.getResource).toHaveBeenCalledTimes(1);
    });

    it('should leave pickupPoint undefined when address2 does not match paczkomat format', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection
      );
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValueOnce(baseOrder)
        .mockResolvedValueOnce({ id: '5', address2: 'Piętro 2' });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toBeUndefined();
    });

    it('should leave pickupPoint undefined when address fetch fails', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection
      );
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValueOnce(baseOrder)
        .mockRejectedValueOnce(new PrestashopApiException('Not Found', 404));
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toBeUndefined();
    });

    it('should normalise paczkomat code to uppercase', async () => {
      const inpostConnection = createTestConnection({
        config: { inpostPsModuleType: 'official_inpost' },
      });
      const inpostAdapter = new PrestashopOrderSourceAdapter(
        mockHttpClient,
        orderMapper,
        inpostConnection
      );
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValueOnce(baseOrder)
        .mockResolvedValueOnce({ id: '5', address2: 'poz08a' });
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce(baseOrderRows);

      const incoming = await inpostAdapter.getOrder({ externalOrderId: '42' });

      expect(incoming.pickupPoint).toEqual({ id: 'POZ08A' });
    });
  });
});
