/**
 * PrestaShop Adapter Factory Wrapper Tests
 *
 * Unit tests for PrestashopAdapterFactoryWrapper. Tests capability routing
 * and adapter creation.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { PrestashopAdapterFactoryWrapper } from '../prestashop-adapter-factory-wrapper';
import { createMockIdentifierMapping } from '../../../__tests__/mocks/mock-identifier-mapping.factory';
import { createMockCredentialsResolver } from '../../../__tests__/mocks/mock-credentials-resolver.factory';
import { createTestConnection } from '../../../__tests__/fixtures/connection.fixture';
import { ProductMasterPort } from '@openlinker/core/products';
import { InventoryMasterPort } from '@openlinker/core/inventory';
import { OrderSourcePort } from '@openlinker/core/orders';

describe('PrestashopAdapterFactoryWrapper', () => {
  let wrapper: PrestashopAdapterFactoryWrapper;
  let mockIdentifierMapping: ReturnType<typeof createMockIdentifierMapping>;
  let mockCredentialsResolver: ReturnType<typeof createMockCredentialsResolver>;
  let connection: ReturnType<typeof createTestConnection>;

  beforeEach(() => {
    wrapper = new PrestashopAdapterFactoryWrapper();
    mockIdentifierMapping = createMockIdentifierMapping();
    mockCredentialsResolver = createMockCredentialsResolver();
    connection = createTestConnection();
  });

  describe('createCapabilityAdapter', () => {
    it('should create ProductMaster adapter', async () => {
      const adapter = await wrapper.createCapabilityAdapter<ProductMasterPort>(
        connection,
        'ProductMaster',
        mockIdentifierMapping,
        mockCredentialsResolver,
      );

      expect(adapter).toBeDefined();
      expect(typeof adapter.getProduct).toBe('function');
      expect(typeof adapter.getProducts).toBe('function');
    });

    it('should create InventoryMaster adapter', async () => {
      const adapter = await wrapper.createCapabilityAdapter<InventoryMasterPort>(
        connection,
        'InventoryMaster',
        mockIdentifierMapping,
        mockCredentialsResolver,
      );

      expect(adapter).toBeDefined();
      expect(typeof adapter.getInventory).toBe('function');
      expect(typeof adapter.getAvailableQuantity).toBe('function');
    });

    it('should create OrderSource adapter', async () => {
      const adapter = await wrapper.createCapabilityAdapter<OrderSourcePort>(
        connection,
        'OrderSource',
        mockIdentifierMapping,
        mockCredentialsResolver,
      );

      expect(adapter).toBeDefined();
      expect(typeof adapter.getOrder).toBe('function');
      expect(typeof adapter.getOrders).toBe('function');
    });

    it('should throw error for unsupported capability', async () => {
      await expect(
        wrapper.createCapabilityAdapter(
          connection,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
          'OrderProcessorManager' as any,
          mockIdentifierMapping,
          mockCredentialsResolver,
        ),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      ).rejects.toThrow('PrestaShop adapter does not support capability: OrderProcessorManager');
    });

    it('should throw error for unknown capability', async () => {
      await expect(
        wrapper.createCapabilityAdapter(
          connection,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
          'UnknownCapability' as any,
          mockIdentifierMapping,
          mockCredentialsResolver,
        ),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      ).rejects.toThrow('PrestaShop adapter does not support capability: UnknownCapability');
    });
  });
});

