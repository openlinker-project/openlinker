/**
 * Unit tests for PrestashopConversionRateResolver (#2102)
 *
 * Covers the three outcomes the outbound order body depends on: the order is in
 * the shop's default currency (exactly 1, no rate read), the order is in another
 * currency (PrestaShop's own `currencies.conversion_rate`), and the rate is not
 * resolvable (an explicit throw, never a fallback 1.0).
 */
import { PrestashopConversionRateResolver } from '../prestashop-conversion-rate.resolver';
import { PrestashopShopCurrencyResolver } from '../prestashop-shop-currency.resolver';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import { PrestashopApiException } from '../../../domain/exceptions/prestashop-api.exception';
import { PrestashopConversionRateUnknownException } from '../../../domain/exceptions/prestashop-conversion-rate-unknown.exception';

describe('PrestashopConversionRateResolver', () => {
  const CONNECTION_ID = 'conn-1';

  let resolver: PrestashopConversionRateResolver;
  let shopCurrencyResolver: PrestashopShopCurrencyResolver;
  let client: jest.Mocked<IPrestashopWebserviceClient>;

  /** The shop's default currency is PLN; EUR is configured at 4.3157. */
  beforeEach(() => {
    shopCurrencyResolver = new PrestashopShopCurrencyResolver();
    resolver = new PrestashopConversionRateResolver(shopCurrencyResolver);

    client = {
      getResource: jest.fn((resource: string, id: string | number) => {
        if (resource === 'currencies' && String(id) === '2') {
          return Promise.resolve({ id: '2', iso_code: 'PLN', conversion_rate: '1.000000' });
        }
        return Promise.resolve({});
      }),
      listResources: jest.fn((resource: string, filters?: unknown) => {
        if (resource === 'configurations') {
          return Promise.resolve([{ id: '1', name: 'PS_CURRENCY_DEFAULT', value: '2' }]);
        }
        if (resource === 'currencies') {
          const iso = (filters as { custom?: { iso_code?: string } } | undefined)?.custom?.iso_code;
          if (iso === 'EUR') {
            return Promise.resolve([{ id: '3', iso_code: 'EUR', conversion_rate: '4.3157' }]);
          }
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      }),
      createResource: jest.fn(),
      updateResource: jest.fn(),
      deleteResource: jest.fn(),
      uploadImage: jest.fn(),
    } as unknown as jest.Mocked<IPrestashopWebserviceClient>;
  });

  describe('order currency equals the shop default currency', () => {
    it('should resolve exactly 1', async () => {
      await expect(resolver.resolveConversionRate('PLN', CONNECTION_ID, client)).resolves.toBe(1);
    });

    it('should not read the currency resource for a rate it can derive', async () => {
      await resolver.resolveConversionRate('PLN', CONNECTION_ID, client);

      expect(client.listResources).not.toHaveBeenCalledWith(
        'currencies',
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });

    it('should compare case-insensitively and ignore surrounding whitespace', async () => {
      await expect(resolver.resolveConversionRate(' pln ', CONNECTION_ID, client)).resolves.toBe(1);
    });
  });

  describe('order currency differs from the shop default currency', () => {
    it("should resolve PrestaShop's own conversion_rate for that currency", async () => {
      await expect(resolver.resolveConversionRate('EUR', CONNECTION_ID, client)).resolves.toBe(
        4.3157
      );

      expect(client.listResources).toHaveBeenCalledWith(
        'currencies',
        { custom: { iso_code: 'EUR' } },
        1,
        0
      );
    });

    it('should accept a numeric conversion_rate as well as a string one', async () => {
      client.listResources.mockImplementation((resource: string) => {
        if (resource === 'configurations') {
          return Promise.resolve([{ id: '1', name: 'PS_CURRENCY_DEFAULT', value: '2' }]);
        }
        return Promise.resolve([{ id: '3', iso_code: 'EUR', conversion_rate: 4.25 }]);
      });

      await expect(resolver.resolveConversionRate('EUR', CONNECTION_ID, client)).resolves.toBe(
        4.25
      );
    });

    it('should re-read the rate on every call (a shop rate is a moving figure)', async () => {
      await resolver.resolveConversionRate('EUR', CONNECTION_ID, client);
      await resolver.resolveConversionRate('EUR', CONNECTION_ID, client);

      const currencyReads = client.listResources.mock.calls.filter(
        ([resource]) => resource === 'currencies'
      );
      expect(currencyReads).toHaveLength(2);
    });
  });

  describe('rate not resolvable', () => {
    it('should throw when the order carries no currency code', async () => {
      await expect(
        resolver.resolveConversionRate(undefined, CONNECTION_ID, client)
      ).rejects.toBeInstanceOf(PrestashopConversionRateUnknownException);
    });

    it('should throw when the currency is not configured in the shop', async () => {
      await expect(
        resolver.resolveConversionRate('USD', CONNECTION_ID, client)
      ).rejects.toBeInstanceOf(PrestashopConversionRateUnknownException);
    });

    it('should throw when the shop currency carries no conversion_rate', async () => {
      client.listResources.mockImplementation((resource: string) => {
        if (resource === 'configurations') {
          return Promise.resolve([{ id: '1', name: 'PS_CURRENCY_DEFAULT', value: '2' }]);
        }
        return Promise.resolve([{ id: '3', iso_code: 'EUR' }]);
      });

      await expect(
        resolver.resolveConversionRate('EUR', CONNECTION_ID, client)
      ).rejects.toBeInstanceOf(PrestashopConversionRateUnknownException);
    });

    it.each([['0'], ['-2.5'], ['abc']])(
      'should throw rather than apply the unusable rate %s',
      async (rate) => {
        client.listResources.mockImplementation((resource: string) => {
          if (resource === 'configurations') {
            return Promise.resolve([{ id: '1', name: 'PS_CURRENCY_DEFAULT', value: '2' }]);
          }
          return Promise.resolve([{ id: '3', iso_code: 'EUR', conversion_rate: rate }]);
        });

        await expect(
          resolver.resolveConversionRate('EUR', CONNECTION_ID, client)
        ).rejects.toBeInstanceOf(PrestashopConversionRateUnknownException);
      }
    );

    it('should throw when the shop states no default currency', async () => {
      client.listResources.mockResolvedValue([]);

      await expect(
        resolver.resolveConversionRate('EUR', CONNECTION_ID, client)
      ).rejects.toBeInstanceOf(PrestashopConversionRateUnknownException);
    });

    it('should never fall back to 1.0 for a foreign currency', async () => {
      client.listResources.mockImplementation((resource: string) => {
        if (resource === 'configurations') {
          return Promise.resolve([{ id: '1', name: 'PS_CURRENCY_DEFAULT', value: '2' }]);
        }
        return Promise.resolve([]);
      });

      await expect(resolver.resolveConversionRate('EUR', CONNECTION_ID, client)).rejects.toThrow(
        /not configured in the shop/
      );
    });
  });

  describe('a refusal is not pinned by the default-currency cache', () => {
    it('should resolve once the operator configures the shop default currency', async () => {
      // First attempt: the shop states no default currency, so the refusal tells
      // the operator to set it and retry. The default-currency read is cached, so
      // that instruction is only honest if the negative entry expires quickly.
      client.listResources.mockImplementationOnce(() => Promise.resolve([]));
      await expect(
        resolver.resolveConversionRate('EUR', CONNECTION_ID, client)
      ).rejects.toBeInstanceOf(PrestashopConversionRateUnknownException);

      const past = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(past + 61 * 1000);
      try {
        await expect(resolver.resolveConversionRate('EUR', CONNECTION_ID, client)).resolves.toBe(
          4.3157
        );
      } finally {
        (Date.now as jest.Mock).mockRestore();
      }
    });
  });

  describe('read failures stay retryable', () => {
    it('should raise a retryable PrestashopApiException when the currency read fails', async () => {
      client.listResources.mockImplementation((resource: string) => {
        if (resource === 'configurations') {
          return Promise.resolve([{ id: '1', name: 'PS_CURRENCY_DEFAULT', value: '2' }]);
        }
        return Promise.reject(new PrestashopApiException('upstream down', 503));
      });

      const error = await resolver
        .resolveConversionRate('EUR', CONNECTION_ID, client)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PrestashopApiException);
      expect(error).not.toBeInstanceOf(PrestashopConversionRateUnknownException);
      expect((error as PrestashopApiException).statusCode).toBe(503);
    });

    it('should raise a retryable PrestashopApiException when the shop default read fails', async () => {
      client.listResources.mockRejectedValue(new Error('timeout'));

      const error = await resolver
        .resolveConversionRate('EUR', CONNECTION_ID, client)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PrestashopApiException);
      expect(error).not.toBeInstanceOf(PrestashopConversionRateUnknownException);
    });
  });
});
