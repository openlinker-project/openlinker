/**
 * PrestaShop Adapter Factory Tests
 *
 * Unit tests for PrestashopAdapterFactory. Tests configuration validation,
 * credential resolution, and adapter instantiation.
 *
 * @module libs/integrations/prestashop/src/application/__tests__
 */
import { PrestashopAdapterFactory } from '../prestashop-adapter.factory';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { PrestashopCredentials } from '@openlinker/integrations-prestashop';
import { PrestashopConfigException } from '@openlinker/integrations-prestashop';

describe('PrestashopAdapterFactory', () => {
  let factory: PrestashopAdapterFactory;
  let mockIdentifierMapping: jest.Mocked<IdentifierMappingPort>;
  let mockCredentialsResolver: jest.Mocked<CredentialsResolverPort>;

  beforeEach(() => {
    factory = new PrestashopAdapterFactory();
    mockIdentifierMapping = {
      getExternalIds: jest.fn(),
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
      getOrCreateExactMapping: jest.fn(),
      deleteMapping: jest.fn(),
      listExternalIdsByConnection: jest.fn(),
    } as jest.Mocked<IdentifierMappingPort>;
    mockCredentialsResolver = {
      get: jest.fn(),
    };
  });

  describe('createAdapters', () => {
    const createTestConnection = (config: Record<string, unknown> = {}): Connection => {
      return {
        id: 'test-connection-id',
        platformType: 'prestashop',
        name: 'Test PrestaShop',
        status: 'active',
        config: {
          baseUrl: 'https://shop.example.com',
          ...config,
        },
        credentialsRef: 'test_credentials',
        adapterKey: undefined,
        enabledCapabilities: [
          'ProductMaster',
          'InventoryMaster',
          'OrderSource',
          'OrderProcessorManager',
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Connection;
    };

    it('should create all three adapters', async () => {
      const connection = createTestConnection();
      mockCredentialsResolver.get.mockResolvedValue({
        webserviceApiKey: 'test-api-key',
      } as PrestashopCredentials);

      const adapters = await factory.createAdapters(
        connection,
        mockIdentifierMapping,
        mockCredentialsResolver
      );

      expect(adapters.productMaster).toBeDefined();
      expect(adapters.inventoryMaster).toBeDefined();
      expect(adapters.orderSource).toBeDefined();
    });

    it('should resolve credentials', async () => {
      const connection = createTestConnection();
      const credentials = { webserviceApiKey: 'test-key' };
      mockCredentialsResolver.get.mockResolvedValue(credentials);

      await factory.createAdapters(connection, mockIdentifierMapping, mockCredentialsResolver);

      expect(mockCredentialsResolver.get).toHaveBeenCalledWith('test_credentials');
    });

    it('should use default config values', async () => {
      const connection = createTestConnection();
      mockCredentialsResolver.get.mockResolvedValue({ webserviceApiKey: 'test-key' });

      const adapters = await factory.createAdapters(
        connection,
        mockIdentifierMapping,
        mockCredentialsResolver
      );

      // Adapters should be created with defaults
      expect(adapters.productMaster).toBeDefined();
    });
  });

  describe('validateAndParseConfig', () => {
    it('should throw PrestashopConfigException for missing baseUrl', () => {
      const factory = new PrestashopAdapterFactory();
      const invalidConfig = {};

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
        (factory as any).validateAndParseConfig(invalidConfig);
      }).toThrow(PrestashopConfigException);
    });

    it('should throw PrestashopConfigException for invalid baseUrl', () => {
      const factory = new PrestashopAdapterFactory();
      const invalidConfig = { baseUrl: 'not-a-url' };

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
        (factory as any).validateAndParseConfig(invalidConfig);
      }).toThrow(PrestashopConfigException);
    });

    it('should validate shopId is positive integer', () => {
      const factory = new PrestashopAdapterFactory();
      const invalidConfig = { baseUrl: 'https://shop.example.com', shopId: -1 };

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
        (factory as any).validateAndParseConfig(invalidConfig);
      }).toThrow(PrestashopConfigException);
    });

    it('should validate timeoutMs is at least 1000ms', () => {
      const factory = new PrestashopAdapterFactory();
      const invalidConfig = { baseUrl: 'https://shop.example.com', timeoutMs: 500 };

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
        (factory as any).validateAndParseConfig(invalidConfig);
      }).toThrow(PrestashopConfigException);
    });

    it('should validate pageSize is between 1 and 1000', () => {
      const factory = new PrestashopAdapterFactory();
      const invalidConfig = { baseUrl: 'https://shop.example.com', pageSize: 2000 };

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
        (factory as any).validateAndParseConfig(invalidConfig);
      }).toThrow(PrestashopConfigException);
    });

    it('should validate responseFormat is valid', () => {
      const factory = new PrestashopAdapterFactory();
      const invalidConfig = { baseUrl: 'https://shop.example.com', responseFormat: 'invalid' };

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
        (factory as any).validateAndParseConfig(invalidConfig);
      }).toThrow(PrestashopConfigException);
    });

    it('should accept valid configuration', () => {
      const factory = new PrestashopAdapterFactory();
      const validConfig = {
        baseUrl: 'https://shop.example.com',
        shopId: 1,
        langId: 1,
        timeoutMs: 30000,
        pageSize: 100,
        responseFormat: 'auto',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = (factory as any).validateAndParseConfig(validConfig);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(result.baseUrl).toBe('https://shop.example.com');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(result.shopId).toBe(1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(result.langId).toBe(1);
    });

    describe('currency', () => {
      const validateConfig = (config: Record<string, unknown>): unknown => {
        const factory = new PrestashopAdapterFactory();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
        return (factory as any).validateAndParseConfig(config);
      };

      it('should accept a valid ISO 4217 code', () => {
        const result = validateConfig({
          baseUrl: 'https://shop.example.com',
          currency: 'PLN',
        }) as { currency?: string };

        expect(result.currency).toBe('PLN');
      });

      it('should normalise lowercase codes to uppercase', () => {
        const result = validateConfig({
          baseUrl: 'https://shop.example.com',
          currency: 'pln',
        }) as { currency?: string };

        expect(result.currency).toBe('PLN');
      });

      it('should leave currency undefined when absent', () => {
        const result = validateConfig({
          baseUrl: 'https://shop.example.com',
        }) as { currency?: string };

        expect(result.currency).toBeUndefined();
      });

      it('should reject a code with wrong length', () => {
        expect(() =>
          validateConfig({
            baseUrl: 'https://shop.example.com',
            currency: 'PL',
          })
        ).toThrow(PrestashopConfigException);
        expect(() =>
          validateConfig({
            baseUrl: 'https://shop.example.com',
            currency: 'PL',
          })
        ).toThrow(/ISO 4217/);
      });

      it('should reject a non-string value', () => {
        expect(() =>
          validateConfig({
            baseUrl: 'https://shop.example.com',
            currency: 123,
          })
        ).toThrow(PrestashopConfigException);
        expect(() =>
          validateConfig({
            baseUrl: 'https://shop.example.com',
            currency: 123,
          })
        ).toThrow(/must be a string/);
      });

      it('should treat empty string as unset', () => {
        const result = validateConfig({
          baseUrl: 'https://shop.example.com',
          currency: '',
        }) as { currency?: string };

        expect(result.currency).toBeUndefined();
      });
    });
  });
});
