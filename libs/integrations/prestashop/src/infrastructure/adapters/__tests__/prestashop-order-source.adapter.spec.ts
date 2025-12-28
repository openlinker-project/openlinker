/**
 * PrestaShop Order Source Adapter Tests
 *
 * Unit tests for PrestashopOrderSourceAdapter. Tests order fetching,
 * identifier mapping, and error handling.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { PrestashopOrderSourceAdapter } from '../prestashop-order-source.adapter';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';
import { createMockIdentifierMapping } from '../../../__tests__/mocks/mock-identifier-mapping.factory';
import { createTestConnection } from '../../../__tests__/fixtures/connection.fixture';
import { PrestashopOrderMapper } from '../../mappers/prestashop-order.mapper';
import { PrestashopResourceNotFoundException } from '@openlinker/integrations-prestashop';
import { PrestashopOrder, PrestashopOrderRow } from '../../mappers/prestashop.mapper.interface';
import { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

describe('PrestashopOrderSourceAdapter', () => {
  let adapter: PrestashopOrderSourceAdapter;
  let mockHttpClient: jest.Mocked<IPrestashopWebserviceClient>;
  let mockIdentifierMapping: jest.Mocked<IdentifierMappingPort>;
  let connection: ReturnType<typeof createTestConnection>;
  let orderMapper: PrestashopOrderMapper;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    mockIdentifierMapping = createMockIdentifierMapping();
    connection = createTestConnection();
    orderMapper = new PrestashopOrderMapper();

    adapter = new PrestashopOrderSourceAdapter(
      mockHttpClient,
      mockIdentifierMapping,
      orderMapper,
      connection,
    );
  });

  describe('getOrder', () => {
    it('should fetch and map a single order successfully', async () => {
      const orderId = 'internal-order-123';
      const externalOrderId = '42';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId: externalOrderId,
          entityType: 'Order',
        },
      ]);

      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-001',
        current_state: '2',
        total_paid: '99.99',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 10:00:00',
      };

      const orderRows: PrestashopOrderRow[] = [
        {
          id: '1',
          id_order: '42',
          product_id: '10',
          product_attribute_id: '0',
          product_quantity: '2',
          product_price: '19.99',
          product_reference: 'PROD-001',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.getResource = jest.fn().mockResolvedValue(prestashopOrder);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest.fn().mockResolvedValue(orderRows);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getOrCreateInternalId = jest.fn().mockResolvedValue('internal-product-10');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await adapter.getOrder(orderId);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith('Order', orderId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('orders', externalOrderId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'order_rows',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          custom: expect.objectContaining({
            id_order: externalOrderId,
          }),
        }),
      );
      expect(result.id).toBe(orderId);
      expect(result.items).toHaveLength(1);
    });

    it('should throw PrestashopResourceNotFoundException when order not found', async () => {
      const orderId = 'internal-order-123';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(adapter.getOrder(orderId)).rejects.toThrow(PrestashopResourceNotFoundException);
    });

    it('should map product IDs to internal IDs', async () => {
      const orderId = 'internal-order-123';
      const externalOrderId = '42';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId: externalOrderId,
          entityType: 'Order',
        },
      ]);

      const prestashopOrder: PrestashopOrder = {
        id: '42',
        reference: 'ORDER-001',
        current_state: '2',
        total_paid: '99.99',
        date_add: '2024-01-01 10:00:00',
        date_upd: '2024-01-01 10:00:00',
      };

      const orderRows: PrestashopOrderRow[] = [
        {
          id: '1',
          id_order: '42',
          product_id: '10',
          product_attribute_id: '0',
          product_quantity: '2',
          product_price: '19.99',
          product_reference: 'PROD-001',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.getResource = jest.fn().mockResolvedValue(prestashopOrder);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest.fn().mockResolvedValue(orderRows);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getOrCreateInternalId = jest.fn().mockResolvedValue('internal-product-10');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await adapter.getOrder(orderId);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockIdentifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Product',
        '10',
        connection.id,
        expect.objectContaining({
          parentEntityType: 'Order',
          parentInternalId: orderId,
        }),
      );
      expect(result.items[0].productId).toBe('internal-product-10');
    });
  });

  describe('getOrders', () => {
    it('should fetch and map multiple orders', async () => {
      const prestashopOrders: PrestashopOrder[] = [
        {
          id: '42',
          reference: 'ORDER-001',
          current_state: '2',
          total_paid: '99.99',
          date_add: '2024-01-01 10:00:00',
          date_upd: '2024-01-01 10:00:00',
        },
        {
          id: '43',
          reference: 'ORDER-002',
          current_state: '3',
          total_paid: '149.99',
          date_add: '2024-01-02 10:00:00',
          date_upd: '2024-01-02 10:00:00',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest
        .fn()
        .mockResolvedValueOnce(prestashopOrders) // Orders
        .mockResolvedValueOnce([]) // Order rows for first order
        .mockResolvedValueOnce([]); // Order rows for second order

      const idMap = new Map([
        ['42:test-connection-id', 'internal-order-1'],
        ['43:test-connection-id', 'internal-order-2'],
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await adapter.getOrders({});

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('internal-order-1');
      expect(result[1].id).toBe('internal-order-2');
    });

    it('should return empty array when no orders found', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await adapter.getOrders({});

      expect(result).toEqual([]);
    });

    it('should pass filters to HTTP client', async () => {
      const prestashopOrders: PrestashopOrder[] = [
        {
          id: '42',
          reference: 'ORDER-001',
          current_state: '2',
          total_paid: '99.99',
          date_add: '2024-01-01 10:00:00',
          date_upd: '2024-01-01 10:00:00',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest
        .fn()
        .mockResolvedValueOnce(prestashopOrders)
        .mockResolvedValueOnce([]);

      const idMap = new Map([['42:test-connection-id', 'internal-order-1']]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      const dateFrom = new Date('2024-01-01');
      const dateTo = new Date('2024-01-31');

      await adapter.getOrders({
        dateFrom,
        dateTo,
        status: 'processing',
        limit: 50,
        offset: 100,
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'orders',
        expect.objectContaining({
          dateFrom,
          dateTo,
          status: ['processing'],
        }),
        50,
        100,
      );
    });

    it('should filter out orders without internal ID mapping', async () => {
      const prestashopOrders: PrestashopOrder[] = [
        {
          id: '42',
          reference: 'ORDER-001',
          current_state: '2',
          total_paid: '99.99',
          date_add: '2024-01-01 10:00:00',
          date_upd: '2024-01-01 10:00:00',
        },
        {
          id: '43',
          reference: 'ORDER-002',
          current_state: '3',
          total_paid: '149.99',
          date_add: '2024-01-02 10:00:00',
          date_upd: '2024-01-02 10:00:00',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest
        .fn()
        .mockResolvedValueOnce(prestashopOrders)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      // Only map first order
      const idMap = new Map([['42:test-connection-id', 'internal-order-1']]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await adapter.getOrders({});

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('internal-order-1');
    });

    it('should handle missing order rows gracefully', async () => {
      const prestashopOrders: PrestashopOrder[] = [
        {
          id: '42',
          reference: 'ORDER-001',
          current_state: '2',
          total_paid: '99.99',
          date_add: '2024-01-01 10:00:00',
          date_upd: '2024-01-01 10:00:00',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest
        .fn()
        .mockResolvedValueOnce(prestashopOrders) // Orders
        .mockRejectedValueOnce(new Error('Failed to fetch order rows')); // Order rows fail

      const idMap = new Map([['42:test-connection-id', 'internal-order-1']]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await adapter.getOrders({});

      // Should still return order, but with empty items
      expect(result).toHaveLength(1);
      expect(result[0].items).toEqual([]);
    });
  });
});

