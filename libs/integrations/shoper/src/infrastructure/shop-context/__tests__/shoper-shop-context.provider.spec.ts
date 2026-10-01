import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { ShoperShopContextProvider } from '../shoper-shop-context.provider';

const CONFIG = {
  default_language_name: 'pl_PL',
  default_currency_name: 'PLN',
  locale_default_weight: 'KILOGRAM',
};

function providerWith(get: jest.Mock): ShoperShopContextProvider {
  return new ShoperShopContextProvider({ get } as unknown as ShoperHttpClient, 'shop.example.pl');
}

describe('ShoperShopContextProvider', () => {
  it('should read language, currency and weight unit from application-config', async () => {
    const get = jest.fn().mockResolvedValue({ status: 200, data: CONFIG });

    await expect(providerWith(get).get()).resolves.toEqual({
      host: 'shop.example.pl',
      language: 'pl_PL',
      currency: 'PLN',
      weightUnit: 'KILOGRAM',
    });
    expect(get).toHaveBeenCalledWith('/application-config');
  });

  it('should share ONE request between concurrent callers and later ones', async () => {
    const get = jest.fn().mockResolvedValue({ status: 200, data: CONFIG });
    const provider = providerWith(get);

    await Promise.all([provider.get(), provider.get(), provider.get()]);
    await provider.get();

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('should not cache a failure: the next call retries', async () => {
    const get = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ status: 200, data: CONFIG });
    const provider = providerWith(get);

    await expect(provider.get()).rejects.toThrow('boom');
    await expect(provider.get()).resolves.toMatchObject({ language: 'pl_PL' });
    expect(get).toHaveBeenCalledTimes(2);
  });

  describe('with a host cache', () => {
    const KEY = 'shoper:shop-context:conn-1:shop.example.pl';

    function cacheStub(initial: unknown = null): {
      cache: { get: jest.Mock; set: jest.Mock; delete: jest.Mock };
    } {
      return {
        cache: {
          get: jest.fn().mockResolvedValue(initial),
          set: jest.fn().mockResolvedValue(undefined),
          delete: jest.fn(),
        },
      };
    }

    function provider(
      get: jest.Mock,
      cache: ReturnType<typeof cacheStub>['cache'],
    ): ShoperShopContextProvider {
      return new ShoperShopContextProvider({ get } as unknown as ShoperHttpClient, 'shop.example.pl', {
        cache,
        cacheKey: KEY,
      });
    }

    it('should skip the shop entirely on a cache hit', async () => {
      const { cache } = cacheStub({
        host: 'stale-host',
        language: 'en_US',
        currency: 'EUR',
        weightUnit: 'KILOGRAM',
      });
      const get = jest.fn();

      const context = await provider(get, cache).get();

      expect(get).not.toHaveBeenCalled();
      // The host always comes from the live connection, never from the cache.
      expect(context).toEqual({
        host: 'shop.example.pl',
        language: 'en_US',
        currency: 'EUR',
        weightUnit: 'KILOGRAM',
      });
    });

    it('should read the shop on a miss and store the answer under the connection-scoped key with a TTL', async () => {
      const { cache } = cacheStub(null);
      const get = jest.fn().mockResolvedValue({ status: 200, data: CONFIG });

      await provider(get, cache).get();

      expect(get).toHaveBeenCalledTimes(1);
      expect(cache.set).toHaveBeenCalledWith(KEY, expect.objectContaining({ language: 'pl_PL' }), 300);
    });

    it('should ignore an entry of an unexpected shape and ask the shop', async () => {
      const { cache } = cacheStub({ language: 42 });
      const get = jest.fn().mockResolvedValue({ status: 200, data: CONFIG });

      await expect(provider(get, cache).get()).resolves.toMatchObject({ language: 'pl_PL' });
      expect(get).toHaveBeenCalledTimes(1);
    });

    it('should still work when the cache itself fails', async () => {
      const { cache } = cacheStub(null);
      cache.get.mockRejectedValue(new Error('redis down'));
      cache.set.mockRejectedValue(new Error('redis down'));
      const get = jest.fn().mockResolvedValue({ status: 200, data: CONFIG });

      await expect(provider(get, cache).get()).resolves.toMatchObject({ currency: 'PLN' });
    });

    it('should not cache a failed shop read', async () => {
      const { cache } = cacheStub(null);
      const get = jest.fn().mockRejectedValue(new Error('shop 500'));

      await expect(provider(get, cache).get()).rejects.toThrow('shop 500');
      expect(cache.set).not.toHaveBeenCalled();
    });
  });

  it('should tolerate a shop that omits the optional fields', async () => {
    const get = jest.fn().mockResolvedValue({ status: 200, data: {} });

    await expect(providerWith(get).get()).resolves.toEqual({
      host: 'shop.example.pl',
      language: '',
      currency: null,
      weightUnit: 'KILOGRAM',
    });
  });
});
