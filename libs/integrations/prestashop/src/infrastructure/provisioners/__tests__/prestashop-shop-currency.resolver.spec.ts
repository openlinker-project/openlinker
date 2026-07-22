/**
 * Unit tests for PrestashopShopCurrencyResolver (#1752)
 *
 * Verifies the shop-default-currency ISO is resolved from `PS_CURRENCY_DEFAULT`
 * → `/currencies/{id}`, cached per connection, and that any failure yields
 * `null` (never throws into product sync).
 */
import { PrestashopShopCurrencyResolver } from '../prestashop-shop-currency.resolver';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';

describe('PrestashopShopCurrencyResolver', () => {
  let resolver: PrestashopShopCurrencyResolver;
  let client: jest.Mocked<IPrestashopWebserviceClient>;

  beforeEach(() => {
    resolver = new PrestashopShopCurrencyResolver();
    client = {
      getResource: jest.fn((resource: string, id: string | number) => {
        if (resource === 'currencies' && String(id) === '2') {
          return Promise.resolve({ id: '2', iso_code: 'PLN' });
        }
        return Promise.resolve({});
      }),
      listResources: jest.fn((resource: string) => {
        if (resource === 'configurations') {
          return Promise.resolve([{ id: '1', name: 'PS_CURRENCY_DEFAULT', value: '2' }]);
        }
        return Promise.resolve([]);
      }),
      createResource: jest.fn(),
      updateResource: jest.fn(),
      deleteResource: jest.fn(),
      uploadImage: jest.fn(),
    } as unknown as jest.Mocked<IPrestashopWebserviceClient>;
  });

  it('should resolve the shop default currency ISO from PS_CURRENCY_DEFAULT', async () => {
    const iso = await resolver.resolveDefaultCurrencyIso('conn-1', client);

    expect(iso).toBe('PLN');
    expect(client.listResources).toHaveBeenCalledWith(
      'configurations',
      { custom: { name: 'PS_CURRENCY_DEFAULT' } },
      1,
      0
    );
    expect(client.getResource).toHaveBeenCalledWith('currencies', '2');
  });

  it('should uppercase the returned iso_code', async () => {
    client.getResource.mockResolvedValueOnce({ id: '2', iso_code: 'eur' });

    const iso = await resolver.resolveDefaultCurrencyIso('conn-1', client);

    expect(iso).toBe('EUR');
  });

  it('should cache per connection — a second call makes no WS request', async () => {
    await resolver.resolveDefaultCurrencyIso('conn-1', client);
    await resolver.resolveDefaultCurrencyIso('conn-1', client);

    expect(client.listResources).toHaveBeenCalledTimes(1);
    expect(client.getResource).toHaveBeenCalledTimes(1);
  });

  it('should fetch independently for different connections', async () => {
    await resolver.resolveDefaultCurrencyIso('conn-1', client);
    await resolver.resolveDefaultCurrencyIso('conn-2', client);

    expect(client.listResources).toHaveBeenCalledTimes(2);
  });

  it('should refetch after the cache is cleared', async () => {
    await resolver.resolveDefaultCurrencyIso('conn-1', client);
    resolver.clearCache('conn-1');
    await resolver.resolveDefaultCurrencyIso('conn-1', client);

    expect(client.listResources).toHaveBeenCalledTimes(2);
  });

  it('should return null when PS_CURRENCY_DEFAULT is absent', async () => {
    client.listResources.mockResolvedValueOnce([]);

    const iso = await resolver.resolveDefaultCurrencyIso('conn-1', client);

    expect(iso).toBeNull();
    expect(client.getResource).not.toHaveBeenCalled();
  });

  it('should return null when the currency has no iso_code', async () => {
    client.getResource.mockResolvedValueOnce({ id: '2' });

    const iso = await resolver.resolveDefaultCurrencyIso('conn-1', client);

    expect(iso).toBeNull();
  });

  it('should return null (never throw) when the WS request fails', async () => {
    client.listResources.mockRejectedValueOnce(new Error('boom'));

    await expect(resolver.resolveDefaultCurrencyIso('conn-1', client)).resolves.toBeNull();
  });

  it('should NOT poison the cache for 24h on a transient failure — the next call retries', async () => {
    // First call: a transient WS blip resolves to null.
    client.listResources.mockRejectedValueOnce(new Error('timeout'));
    const first = await resolver.resolveDefaultCurrencyIso('conn-1', client);
    expect(first).toBeNull();

    // A short-TTL failure entry must not survive; jump past FAILURE_CACHE_TTL_MS.
    const realNow = Date.now;
    const past = realNow();
    jest.spyOn(Date, 'now').mockReturnValue(past + 61 * 1000);
    try {
      // Second call: the client is healthy again → resolves the real ISO,
      // proving the transient null was not cached under the full 24h TTL.
      const second = await resolver.resolveDefaultCurrencyIso('conn-1', client);
      expect(second).toBe('PLN');
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }
    expect(client.listResources).toHaveBeenCalledTimes(2);
  });

  it('should cache a definitive absence for the full TTL (no short-TTL retry)', async () => {
    client.listResources.mockResolvedValueOnce([]);
    const first = await resolver.resolveDefaultCurrencyIso('conn-1', client);
    expect(first).toBeNull();

    // Past the failure TTL but well within the 24h definitive TTL: no refetch.
    const past = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(past + 61 * 1000);
    try {
      const second = await resolver.resolveDefaultCurrencyIso('conn-1', client);
      expect(second).toBeNull();
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }
    expect(client.listResources).toHaveBeenCalledTimes(1);
  });
});
