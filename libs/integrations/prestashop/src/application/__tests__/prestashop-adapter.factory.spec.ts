/**
 * PrestaShop Adapter Factory Tests
 *
 * Unit tests for PrestashopAdapterFactory. Tests configuration validation,
 * credential resolution, and adapter instantiation.
 *
 * @module libs/integrations/prestashop/src/application/__tests__
 */
import { PrestashopAdapterFactory } from '../prestashop-adapter.factory';
import { PrestashopShopCurrencyResolver } from '../../infrastructure/provisioners/prestashop-shop-currency.resolver';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { PrestashopCredentials } from '@openlinker/integrations-prestashop';
import { PrestashopConfigException } from '@openlinker/integrations-prestashop';
import { DEFAULT_INSTALL_ORDER_STATES } from '../../__tests__/fixtures/prestashop-order-states.fixture';

describe('PrestashopAdapterFactory', () => {
  let factory: PrestashopAdapterFactory;
  let mockIdentifierMapping: jest.Mocked<IdentifierMappingPort>;
  let mockCredentialsResolver: jest.Mocked<CredentialsResolverPort>;
  // Connection-bound outbound transport (#1810) — a bare jest.fn() stub is
  // enough here since these tests exercise adapter wiring, not rate limiting.
  const mockFetchImpl = jest.fn() as unknown as typeof fetch;

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
        mockCredentialsResolver,
        mockFetchImpl
      );

      expect(adapters.productMaster).toBeDefined();
      expect(adapters.inventoryMaster).toBeDefined();
      expect(adapters.orderSource).toBeDefined();
      expect(adapters.productPublisher).toBeDefined();
    });

    it('should resolve credentials', async () => {
      const connection = createTestConnection();
      const credentials = { webserviceApiKey: 'test-key' };
      mockCredentialsResolver.get.mockResolvedValue(credentials);

      await factory.createAdapters(connection, mockIdentifierMapping, mockCredentialsResolver, mockFetchImpl);

      expect(mockCredentialsResolver.get).toHaveBeenCalledWith('test_credentials');
    });

    it('should use default config values', async () => {
      const connection = createTestConnection();
      mockCredentialsResolver.get.mockResolvedValue({ webserviceApiKey: 'test-key' });

      const adapters = await factory.createAdapters(
        connection,
        mockIdentifierMapping,
        mockCredentialsResolver,
        mockFetchImpl
      );

      // Adapters should be created with defaults
      expect(adapters.productMaster).toBeDefined();
    });

    it('should resolve the shop-default currency when config.currency is unset', async () => {
      const resolveSpy = jest
        .spyOn(PrestashopShopCurrencyResolver.prototype, 'resolveDefaultCurrencyIso')
        .mockResolvedValue('PLN');
      const connection = createTestConnection();
      mockCredentialsResolver.get.mockResolvedValue({ webserviceApiKey: 'test-key' });

      await factory.createAdapters(connection, mockIdentifierMapping, mockCredentialsResolver, mockFetchImpl);

      expect(resolveSpy).toHaveBeenCalledWith('test-connection-id', expect.anything());
      resolveSpy.mockRestore();
    });

    it('should not resolve the shop-default currency when config.currency is set (explicit wins)', async () => {
      const resolveSpy = jest.spyOn(
        PrestashopShopCurrencyResolver.prototype,
        'resolveDefaultCurrencyIso'
      );
      const connection = createTestConnection({ currency: 'EUR' });
      mockCredentialsResolver.get.mockResolvedValue({ webserviceApiKey: 'test-key' });

      await factory.createAdapters(connection, mockIdentifierMapping, mockCredentialsResolver, mockFetchImpl);

      expect(resolveSpy).not.toHaveBeenCalled();
      resolveSpy.mockRestore();
    });

    // Pins the request count, not just the wiring: the shop-currency pair used
    // to be re-read on every child job because the plugin built a fresh factory
    // per capability resolution, discarding this resolver's cache (#2592). One
    // factory serving two resolutions must read the pair once.
    it('should read the shop-currency pair only once across two adapter builds (#2592)', async () => {
      const urls: string[] = [];
      const countingFetch = jest.fn((input: unknown) => {
        const url = String(input);
        urls.push(url);
        const body = url.includes('/api/configurations')
          ? JSON.stringify({ configurations: [{ id: '1', value: '2' }] })
          : JSON.stringify({ currency: { id: '2', iso_code: 'PLN' } });
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(body),
        });
      }) as unknown as typeof fetch;

      const connection = createTestConnection();
      mockCredentialsResolver.get.mockResolvedValue({ webserviceApiKey: 'test-key' });

      await factory.createAdapters(
        connection,
        mockIdentifierMapping,
        mockCredentialsResolver,
        countingFetch
      );
      await factory.createAdapters(
        connection,
        mockIdentifierMapping,
        mockCredentialsResolver,
        countingFetch
      );

      expect(urls.filter((u) => u.includes('/api/configurations'))).toHaveLength(1);
      expect(urls.filter((u) => u.includes('/api/currencies'))).toHaveLength(1);
    });

    // The caches are keyed by connection id and live for the process, and the id
    // does not change when an operator repoints the connection at another shop.
    // Without the shop-identity check the second build would answer from the
    // first shop's cache and read nothing.
    it('should re-read shop-level facts when the connection is repointed at another shop (#2592)', async () => {
      const urls: string[] = [];
      const countingFetch = jest.fn((input: unknown) => {
        const url = String(input);
        urls.push(url);
        const body = url.includes('/api/configurations')
          ? JSON.stringify({ configurations: [{ id: '1', value: '2' }] })
          : JSON.stringify({ currency: { id: '2', iso_code: 'PLN' } });
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(body),
        });
      }) as unknown as typeof fetch;

      mockCredentialsResolver.get.mockResolvedValue({ webserviceApiKey: 'test-key' });

      await factory.createAdapters(
        createTestConnection(),
        mockIdentifierMapping,
        mockCredentialsResolver,
        countingFetch
      );
      await factory.createAdapters(
        createTestConnection({ baseUrl: 'https://other-shop.example.com' }),
        mockIdentifierMapping,
        mockCredentialsResolver,
        countingFetch
      );

      expect(urls.filter((u) => u.includes('/api/configurations'))).toHaveLength(2);
      expect(urls.filter((u) => u.includes('/api/currencies'))).toHaveLength(2);
    });

    // Pins the factory-level wiring, not just the adapter's own unit behaviour:
    // one factory serving two order-feed poll cycles must remember the code-38
    // refusal (#2877) across the fresh `orderSource` adapter each cycle builds,
    // the same process-singleton-cache shape #2592 pinned for the currency pair.
    it('should remember a shop-wide date_upd sort/filter refusal across two order-source builds (#2877)', async () => {
      const ordersUrls: string[] = [];
      const respondingFetch = jest.fn((input: unknown) => {
        const url = String(input);
        if (url.includes('/api/order_states')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify(DEFAULT_INSTALL_ORDER_STATES)),
          });
        }
        if (url.includes('/api/orders')) {
          ordersUrls.push(url);
          if (url.includes('date_upd')) {
            return Promise.resolve({
              ok: false,
              status: 500,
              headers: new Headers({ 'content-type': 'application/json' }),
              text: () =>
                Promise.resolve(
                  JSON.stringify({
                    errors: [{ code: 38, message: 'Unable to filter by this field.' }],
                  })
                ),
            });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve('[]'),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('[]'),
        });
      }) as unknown as typeof fetch;

      const connection = createTestConnection();
      mockCredentialsResolver.get.mockResolvedValue({ webserviceApiKey: 'test-key' });

      const first = await factory.createAdapters(
        connection,
        mockIdentifierMapping,
        mockCredentialsResolver,
        respondingFetch
      );
      await first.orderSource.listOrderFeed({ fromCursor: null, limit: 10 });

      const second = await factory.createAdapters(
        connection,
        mockIdentifierMapping,
        mockCredentialsResolver,
        respondingFetch
      );
      await second.orderSource.listOrderFeed({ fromCursor: null, limit: 10 });

      // First cycle: the client's own 5xx retry ladder burns 1 initial attempt
      // plus 3 retries on the doomed date_upd request (a cost this fix accepts
      // once per connection, per the adapter's own header comment) before the
      // adapter falls back and reads once by id. Second cycle: the factory-held
      // cache already knows - one request only, no retries, no date_upd at all.
      expect(ordersUrls.filter((u) => u.includes('date_upd'))).toHaveLength(4);
      // Bracketed, not a bare `id_ASC` substring test - `sort=[date_upd_ASC,id_ASC]`
      // also contains `id_ASC`, and this must count only the id-only fallback.
      expect(ordersUrls.filter((u) => u.includes('[id_ASC]'))).toHaveLength(2);
    }, 20000);

    // The refusal is a fact about the SHOP, not the connection row (see the
    // #2592 repoint test above for the identical reasoning applied to the
    // currency/configuration caches). Without wiring the order-feed
    // capability cache into `dropCachesOnShopIdentityChange`, a connection
    // repointed away from the refusing shop would stay stuck reading
    // id-only forever, even though the new shop happily accepts `date_upd`.
    it('should re-attempt date_upd sort when the connection is repointed at another shop (#2877)', async () => {
      const ordersUrls: string[] = [];
      const respondingFetch = jest.fn((input: unknown) => {
        const url = String(input);
        if (url.includes('/api/order_states')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify(DEFAULT_INSTALL_ORDER_STATES)),
          });
        }
        if (url.includes('/api/orders')) {
          ordersUrls.push(url);
          if (url.includes('date_upd') && url.startsWith('https://refusing-shop.example.com')) {
            return Promise.resolve({
              ok: false,
              status: 500,
              headers: new Headers({ 'content-type': 'application/json' }),
              text: () =>
                Promise.resolve(
                  JSON.stringify({
                    errors: [{ code: 38, message: 'Unable to filter by this field.' }],
                  })
                ),
            });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve('[]'),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('[]'),
        });
      }) as unknown as typeof fetch;

      mockCredentialsResolver.get.mockResolvedValue({ webserviceApiKey: 'test-key' });

      // First shop refuses date_upd - the connection falls back and the
      // refusal is cached under this connection id.
      const first = await factory.createAdapters(
        createTestConnection({ baseUrl: 'https://refusing-shop.example.com' }),
        mockIdentifierMapping,
        mockCredentialsResolver,
        respondingFetch
      );
      await first.orderSource.listOrderFeed({ fromCursor: null, limit: 10 });
      expect(ordersUrls.filter((u) => u.includes('date_upd'))).toHaveLength(4);

      ordersUrls.length = 0;

      // Same connection id, repointed at a different shop that accepts
      // date_upd fine - the stale refusal must not leak across the repoint.
      const second = await factory.createAdapters(
        createTestConnection({ baseUrl: 'https://accepting-shop.example.com' }),
        mockIdentifierMapping,
        mockCredentialsResolver,
        respondingFetch
      );
      await second.orderSource.listOrderFeed({ fromCursor: null, limit: 10 });

      expect(ordersUrls.filter((u) => u.includes('date_upd'))).toHaveLength(1);
      expect(ordersUrls.filter((u) => u.includes('[id_ASC]'))).toHaveLength(0);
    }, 20000);
  });

  describe('validateAndParseConfig', () => {
    it('should throw PrestashopConfigException for missing baseUrl', () => {
      const factory = new PrestashopAdapterFactory();
      const invalidConfig = {};

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- test mock: explicit any narrows the dynamic spy / fixture shape
        (factory as any).validateAndParseConfig(invalidConfig);
      }).toThrow(PrestashopConfigException);
    });

    it('should throw PrestashopConfigException for invalid baseUrl', () => {
      const factory = new PrestashopAdapterFactory();
      const invalidConfig = { baseUrl: 'not-a-url' };

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- test mock: explicit any narrows the dynamic spy / fixture shape
        (factory as any).validateAndParseConfig(invalidConfig);
      }).toThrow(PrestashopConfigException);
    });

    it('should validate shopId is positive integer', () => {
      const factory = new PrestashopAdapterFactory();
      const invalidConfig = { baseUrl: 'https://shop.example.com', shopId: -1 };

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- test mock: explicit any narrows the dynamic spy / fixture shape
        (factory as any).validateAndParseConfig(invalidConfig);
      }).toThrow(PrestashopConfigException);
    });

    it('should validate timeoutMs is at least 1000ms', () => {
      const factory = new PrestashopAdapterFactory();
      const invalidConfig = { baseUrl: 'https://shop.example.com', timeoutMs: 500 };

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- test mock: explicit any narrows the dynamic spy / fixture shape
        (factory as any).validateAndParseConfig(invalidConfig);
      }).toThrow(PrestashopConfigException);
    });

    it('should validate pageSize is between 1 and 1000', () => {
      const factory = new PrestashopAdapterFactory();
      const invalidConfig = { baseUrl: 'https://shop.example.com', pageSize: 2000 };

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- test mock: explicit any narrows the dynamic spy / fixture shape
        (factory as any).validateAndParseConfig(invalidConfig);
      }).toThrow(PrestashopConfigException);
    });

    it('should validate responseFormat is valid', () => {
      const factory = new PrestashopAdapterFactory();
      const invalidConfig = { baseUrl: 'https://shop.example.com', responseFormat: 'invalid' };

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- test mock: explicit any narrows the dynamic spy / fixture shape
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const result = (factory as any).validateAndParseConfig(validConfig);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(result.baseUrl).toBe('https://shop.example.com');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(result.shopId).toBe(1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(result.langId).toBe(1);
    });

    describe('currency', () => {
      const validateConfig = (config: Record<string, unknown>): unknown => {
        const factory = new PrestashopAdapterFactory();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- test mock: explicit any narrows the dynamic spy / fixture shape
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
